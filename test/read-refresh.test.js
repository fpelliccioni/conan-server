import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, symlink, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('a silent read-clone pull is bounded and HTTP startup recovers', { timeout: 20_000 }, async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'read-clone-timeout-'));
    const app = path.join(root, 'app'), data = path.join(root, 'data'), bin = path.join(root, 'bin');
    await mkdir(app); await mkdir(data); await mkdir(bin);
    let child, exited, rescue, killPull = () => {};
    t.after(async () => {
        clearTimeout(rescue); killPull();
        if (child) { child.kill(); await exited; }
        await rm(root, { recursive: true, force: true });
    });
    await cp(fileURLToPath(new URL('../src', import.meta.url)), path.join(app, 'src'), { recursive: true });
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(app, 'node_modules'));
    await writeFile(path.join(app, 'package.json'), '{"type":"module"}');
    const github = path.join(app, 'src/github.js');
    // Compress only the production deadline in the isolated server copy. Its
    // Git operations, cancellation path, startup and HTTP handler are unchanged.
    const source = await readFile(github, 'utf8');
    await writeFile(github, source.replace('options.timeoutMs ?? 120_000', 'options.timeoutMs ?? 2000'));
    const exec = promisify(execFile);
    const realGit = (await exec('which', ['git'])).stdout.trim();
    const env = { ...process.env };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
        'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_PREFIX']) delete env[key];
    await exec(realGit, ['init'], { cwd: data, env });
    const pidFile = path.join(root, 'pull.pid');
    await writeFile(path.join(bin, 'git'), `#!${process.execPath}\n` + `
const {spawnSync} = require('node:child_process');
if (process.argv.slice(2).includes('pull')) {
 require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
 setInterval(()=>{},1000);
} else {
 const r=spawnSync(${JSON.stringify(realGit)},process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);
}
`, { mode: 0o700 });
    const reserve = net.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
    const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
    child = spawn(process.execPath, [path.join(app, 'src/index.js')], {
        cwd: app, env: { ...env, PATH: `${bin}${path.delimiter}${env.PATH}`, PORT: String(port),
            GIT_REPO_DIR: data, OWNER: 'fixture', REPO: 'fixture', BRANCH: 'master' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    exited = once(child, 'exit'); child.stderr.resume();
    let rescued = false;
    killPull = () => { try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch {} };
    rescue = setTimeout(() => { rescued = true; killPull(); }, 6000);
    await new Promise((resolve, reject) => {
        let output = '';
        child.stdout.on('data', bytes => {
            output += bytes;
            if (output.includes('Server listening on port')) resolve();
        });
        child.once('error', reject);
        child.once('exit', () => reject(new Error('server exited before HTTP readiness')));
    });
    assert.ok(Number(await readFile(pidFile, 'utf8')) > 0, 'the real pull branch must have started');
    assert.equal(rescued, false, 'silent Git pull required test rescue instead of its own deadline');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/ping`)).status, 200);
});
