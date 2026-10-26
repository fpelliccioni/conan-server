import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('Conan binary search exposes published package metadata over HTTP', { timeout: 30_000 }, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'conan-search-'));
    const revision = path.join(root, 'sample/1.0/rrev');
    const pid = 'a'.repeat(40);
    const packageDir = path.join(revision, 'packages', pid, 'prev');
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(path.dirname(packageDir), 'latest.json'), JSON.stringify({ revision: 'prev', time: '2026-10-26T00:00:00Z' }));
    const info = '[settings]\nos=Linux\narch=x86_64\n[options]\nshared=False\n[requires]\n';
    await writeFile(path.join(packageDir, 'conaninfo.txt'), info);
    for (const [id, latest] of [['b'.repeat(40), '{broken JSON'],
        ['c'.repeat(40), JSON.stringify({ revision: '.' })]]) {
        const dir = path.join(revision, 'packages', id);
        await mkdir(dir);
        await writeFile(path.join(dir, 'latest.json'), latest);
        await writeFile(path.join(dir, 'conaninfo.txt'), info);
    }
    // Give startup a real upstream so the HTTP failure cannot be a broken clone.
    const exec = promisify(execFile);
    const repositoryVariables = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE',
        'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_PREFIX'];
    const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !repositoryVariables.includes(key)));
    const git = (...args) => exec('git', ['-c', 'user.name=Package test',
        '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, env: gitEnv });
    const origin = `${root}-origin.git`;
    await git('init', '--bare', origin);
    await git('init');
    await git('symbolic-ref', 'HEAD', 'refs/heads/master');
    await git('add', 'sample');
    await git('commit', '-m', 'Published fixture');
    await git('remote', 'add', 'origin', origin);
    await git('push', '-u', 'origin', 'master');
    const reserve = net.createServer();
    reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
    const port = reserve.address().port;
    await new Promise(resolve => reserve.close(resolve));
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/index.js', import.meta.url))], {
        cwd: root,
        env: { ...gitEnv, PORT: String(port), GIT_REPO_DIR: root, OWNER: 'test', REPO: 'test', BRANCH: 'master' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    t.after(async () => {
        child.kill(); await exited;
        await rm(root, { recursive: true, force: true });
        await rm(origin, { recursive: true, force: true });
    });
    child.stderr.resume();
    await new Promise((resolve, reject) => {
        let output = '';
        child.stdout.on('data', data => {
            output += data;
            if (output.includes('Server listening on port')) resolve();
        });
        child.once('error', reject);
        child.once('exit', () => reject(new Error('server exited before listening')));
    });
    const url = `http://127.0.0.1:${port}/api/v2/conans/sample/1.0/_/_/revisions/rrev/search`;
    const response = await fetch(`${url}?list_only=False`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { [pid]: { content: info } });
    const ids = await fetch(`${url}?list_only=True`);
    assert.deepEqual(await ids.json(), { [pid]: {} });
    await mkdir(path.join(root, 'empty/1.0/rrev'), { recursive: true });
    const empty = await fetch(url.replace('sample', 'empty'));
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), {});
    assert.equal((await fetch(url.replace('sample', 'absent'))).status, 404);
});
