import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import { once } from 'node:events';

const exec = promisify(execFile);
const repositoryVariables = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_PREFIX'];
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !repositoryVariables.includes(key)));
const git = async (cwd, ...args) => (await exec('git', [
    '-c', 'user.name=Package test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', ...args,
], { cwd, env: gitEnv })).stdout.trim();

// Model the same REST refusal that kept the 46 MB Linux release in staging.
// This replaces only the external API; the public publisher and real files run.
mock.module('@octokit/rest', { defaultExport: class {
    git = {
        getRef: async () => ({ data: { object: { sha: 'base' } } }),
        getCommit: async () => ({ data: { tree: { sha: 'tree' } } }),
        createBlob: async ({ content }) => {
            if (Buffer.byteLength(content) > 50_000_000) {
                throw new Error('Sorry, your input was too large to process. Consider creating the blob in a local clone of the repository and then pushing it to GitHub.');
            }
            return { data: { sha: 'small' } };
        },
        createTree: async () => ({ data: { sha: 'tree' } }),
        createCommit: async () => ({ data: { sha: 'commit' } }),
        updateRef: async () => {},
    };
} });
const { uploadToRepo } = await import('../src/github.js');

async function fixture(t) {
    const root = await mkdtemp(path.join(tmpdir(), 'publisher-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const remote = path.join(root, 'remote.git');
    const seed = path.join(root, 'seed');
    const stage = path.join(root, 'stage');
    await mkdir(seed); await mkdir(stage);
    await git(root, 'init', '--bare', remote);
    await git(seed, 'init');
    await git(seed, 'symbolic-ref', 'HEAD', 'refs/heads/master');
    await writeFile(path.join(seed, 'keep.txt'), 'unrelated package');
    await git(seed, 'add', 'keep.txt');
    await git(seed, 'commit', '-m', 'Initial packages');
    await git(seed, 'push', remote, 'master');
    return { root, remote, seed, stage };
}

test('publishes a 46 MB binary intact and preserves unrelated remote files', async (t) => {
    const f = await fixture(t);
    const bytes = Buffer.alloc(46_172_362, 0xa7);
    await writeFile(path.join(f.stage, 'conan_package.tgz'), bytes);
    await uploadToRepo('not-a-real-token', f.stage, 'k-nuth', 'conan-packages',
        'master', 'Upload release', { remoteUrl: f.remote });
    const { stdout: actual } = await exec('git', ['--git-dir', f.remote,
        'show', 'master:conan_package.tgz'], { encoding: 'buffer', maxBuffer: 50_000_000 });
    assert.deepEqual(actual, bytes);
    assert.equal(await git(f.root, '--git-dir', f.remote, 'show', 'master:keep.txt'), 'unrelated package');
    assert.deepEqual(await readFile(path.join(f.stage, 'conan_package.tgz')), bytes,
        'publication must leave staging cleanup to publishStaging');
});

test('repeating the same upload does not add an empty commit', async (t) => {
    const f = await fixture(t);
    await writeFile(path.join(f.stage, 'metadata.txt'), 'release metadata');
    const publish = () => uploadToRepo('not-a-real-token', f.stage, 'k-nuth',
        'conan-packages', 'master', 'Upload release', { remoteUrl: f.remote });
    await publish();
    const before = await git(f.root, '--git-dir', f.remote, 'rev-parse', 'master');
    await publish();
    assert.equal(await git(f.root, '--git-dir', f.remote, 'rev-parse', 'master'), before);
});

test('a rejected push leaves the remote and staging intact', async (t) => {
    const f = await fixture(t);
    await writeFile(path.join(f.remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    await writeFile(path.join(f.stage, 'metadata.txt'), 'retained upload');
    const before = await git(f.root, '--git-dir', f.remote, 'rev-parse', 'master');
    await assert.rejects(uploadToRepo('not-a-real-token', f.stage, 'k-nuth',
        'conan-packages', 'master', 'Upload release', { remoteUrl: f.remote }));
    assert.equal(await git(f.root, '--git-dir', f.remote, 'rev-parse', 'master'), before);
    assert.equal(await readFile(path.join(f.stage, 'metadata.txt'), 'utf8'), 'retained upload');
});

test('a competing remote update is preserved when the push loses the race', async (t) => {
    const f = await fixture(t);
    await writeFile(path.join(f.seed, 'other.txt'), 'parallel upload');
    await git(f.seed, 'add', 'other.txt');
    await git(f.seed, 'commit', '-m', 'Parallel publication');
    await git(f.seed, 'push', f.remote, 'master:parallel');
    const parallel = await git(f.seed, 'rev-parse', 'master');
    await writeFile(path.join(f.remote, 'hooks', 'pre-receive'),
        '#!/bin/sh\nunset GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES\ngit update-ref refs/heads/master refs/heads/parallel\n', { mode: 0o700 });
    await writeFile(path.join(f.stage, 'metadata.txt'), 'retained upload');
    await assert.rejects(uploadToRepo('not-a-real-token', f.stage, 'k-nuth',
        'conan-packages', 'master', 'Upload release', { remoteUrl: f.remote }));
    assert.equal(await git(f.root, '--git-dir', f.remote, 'rev-parse', 'master'), parallel);
    assert.equal(await git(f.root, '--git-dir', f.remote, 'show', 'master:other.txt'), 'parallel upload');
    assert.equal(await readFile(path.join(f.stage, 'metadata.txt'), 'utf8'), 'retained upload');
});

test('Git receives the credential through askpass and failures do not echo it', async (t) => {
    const f = await fixture(t);
    const token = 'credential-used-only-in-this-test';
    const expected = `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
    let authenticated = false;
    const server = http.createServer((req, res) => {
        if (!req.headers.authorization) {
            res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="packages"' });
        } else {
            authenticated = req.headers.authorization === expected;
            res.writeHead(403);
        }
        res.end();
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    await assert.rejects(uploadToRepo(token, f.stage, 'k-nuth', 'conan-packages',
        'master', 'Upload release', { remoteUrl: `http://127.0.0.1:${server.address().port}/repo.git` }),
        err => !err.message.includes(token));
    assert.equal(authenticated, true);
});

test('publishes files even when the remote ignores package archives', async (t) => {
    const f = await fixture(t);
    await writeFile(path.join(f.seed, '.gitignore'), '*.tgz\n');
    await git(f.seed, 'add', '.gitignore');
    await git(f.seed, 'commit', '-m', 'Ignore local archives');
    await git(f.seed, 'push', f.remote, 'master');
    await writeFile(path.join(f.stage, 'conan_package.tgz'), 'archive bytes');
    await uploadToRepo('not-a-real-token', f.stage, 'k-nuth', 'conan-packages',
        'master', 'Upload release', { remoteUrl: f.remote });
    assert.equal(await git(f.root, '--git-dir', f.remote, 'show', 'master:conan_package.tgz'), 'archive bytes');
});

test('an inherited repository environment does not redirect the publication', async (t) => {
    const f = await fixture(t);
    const before = await git(f.seed, 'rev-parse', 'HEAD');
    await writeFile(path.join(f.stage, 'metadata.txt'), 'isolated publication');
    const variables = { GIT_DIR: path.join(f.seed, '.git'), GIT_WORK_TREE: f.seed,
        GIT_INDEX_FILE: path.join(f.seed, '.git', 'index') };
    const saved = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
    try {
        Object.assign(process.env, variables);
        await uploadToRepo('not-a-real-token', f.stage, 'k-nuth', 'conan-packages',
            'master', 'Upload release', { remoteUrl: f.remote });
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
    assert.equal(await git(f.seed, 'rev-parse', 'HEAD'), before);
    assert.equal(await git(f.root, '--git-dir', f.remote, 'show', 'master:metadata.txt'), 'isolated publication');
});

// Serve the actual Git smart-HTTP protocol and count the fetch response bytes.
// Reusing a warm read clone must avoid downloading its unrelated binary blobs.
async function gitHttp(t, root) {
    const { spawn } = await import('node:child_process');
    let fetched = 0;
    const children = new Set();
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const child = spawn('git', ['http-backend'], { env: { ...gitEnv,
            GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1',
            REQUEST_METHOD: req.method, PATH_INFO: url.pathname,
            QUERY_STRING: url.search.slice(1), CONTENT_TYPE: req.headers['content-type'] || '',
            REMOTE_ADDR: '127.0.0.1', REMOTE_USER: 'fixture', CONTENT_LENGTH: req.headers['content-length'] || '',
        }, stdio: ['pipe', 'pipe', 'pipe'] });
        children.add(child);
        let headers = Buffer.alloc(0), sent = false;
        child.stdout.on('data', chunk => {
            if (!sent) {
                headers = Buffer.concat([headers, chunk]);
                const split = headers.indexOf('\r\n\r\n');
                if (split < 0) return;
                for (const line of headers.subarray(0, split).toString().split('\r\n')) {
                    const at = line.indexOf(':');
                    if (at < 0) continue;
                    const key = line.slice(0, at), value = line.slice(at + 1).trim();
                    if (key.toLowerCase() === 'status') res.statusCode = Number(value.split(' ')[0]);
                    else res.setHeader(key, value);
                }
                chunk = headers.subarray(split + 4); sent = true;
            }
            if (url.pathname.endsWith('/git-upload-pack')) fetched += chunk.length;
            res.write(chunk);
        });
        child.on('close', () => { children.delete(child); res.end(); });
        child.stderr.resume(); req.pipe(child.stdin);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => {
        for (const child of children) child.kill('SIGKILL');
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    return { url: `http://127.0.0.1:${server.address().port}/remote.git`, bytes: () => fetched };
}

test('a warm read clone prevents downloading unrelated package blobs', async t => {
    const f = await fixture(t);
    const { randomBytes } = await import('node:crypto');
    await writeFile(path.join(f.seed, 'large-unrelated.tgz'), randomBytes(2 * 1024 * 1024));
    await git(f.seed, 'add', 'large-unrelated.tgz');
    await git(f.seed, 'commit', '-m', 'Existing binary package');
    await git(f.seed, 'push', f.remote, 'master');
    const before = await git(f.seed, 'rev-parse', 'HEAD');
    const parallel = path.join(f.root, 'parallel');
    await git(f.root, 'clone', f.remote, parallel);
    await writeFile(path.join(parallel, 'remote-only.txt'), 'another publisher');
    await git(parallel, 'add', 'remote-only.txt');
    await git(parallel, 'commit', '-m', 'Advance remote beyond the read cache');
    await git(parallel, 'push', f.remote, 'master');
    const server = await gitHttp(t, f.root);
    await writeFile(path.join(f.stage, 'new-metadata.txt'), 'new revision');
    await uploadToRepo('not-a-real-token', f.stage, 'k-nuth', 'conan-packages',
        'master', 'Publish incrementally', { remoteUrl: server.url, objectSource: f.seed });
    t.diagnostic(`Incremental fetch transferred ${server.bytes()} bytes for a repository containing a 2 MiB binary`);
    assert.equal(await git(f.root, '--git-dir', f.remote, 'show', 'master:remote-only.txt'), 'another publisher');
    assert.ok(server.bytes() < 32 * 1024, `downloaded ${server.bytes()} bytes from the warm remote`);
    assert.equal(await git(f.seed, 'rev-parse', 'HEAD'), before, 'the read clone must not be checked out or committed by the writer');
    assert.equal(await git(f.seed, 'status', '--porcelain'), '');
    assert.equal(await git(f.root, '--git-dir', f.remote, 'show', 'master:new-metadata.txt'), 'new revision');
});

test('a timed-out publication kills descendants before removing its checkout', async t => {
    if (process.platform === 'win32') return t.skip('production publisher uses POSIX process groups');
    const f = await fixture(t);
    const { chmod } = await import('node:fs/promises');
    const realGit = (await exec('which', ['git'])).stdout.trim();
    const bin = path.join(f.root, 'bin'); await mkdir(bin);
    const pidFile = path.join(f.root, 'descendant.pid');
    const wrapper = `#!${process.execPath}\n` + `
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
if (!process.argv.slice(2).includes('fetch')) {
 const r = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), {stdio:'inherit'}); process.exit(r.status ?? 1);
}
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"], {stdio:['ignore','pipe','inherit']});
child.stdout.once('data',()=>fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)));
setInterval(()=>{},1000);
`;
    await writeFile(path.join(bin, 'git'), wrapper); await chmod(path.join(bin, 'git'), 0o700);
    const previous = process.env.PATH; process.env.PATH = `${bin}${path.delimiter}${previous}`;
    let rescued = false;
    const { readFileSync } = await import('node:fs');
    const alive = pid => {
        try {
            // A zombie holds no descriptors; only its parent/init can reap it.
            if (process.platform === 'linux' && readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[0] === 'Z') return false;
            process.kill(pid, 0); return true;
        } catch { return false; }
    };
    const rescue = setTimeout(() => {
        rescued = true;
        try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch {}
    }, 6000);
    try {
        await assert.rejects(uploadToRepo('not-a-real-token', f.stage, 'k-nuth', 'conan-packages',
            'master', 'Timeout control', { remoteUrl: f.remote, timeoutMs: 2000, killGraceMs: 100 }));
        const pid = Number(await readFile(pidFile, 'utf8'));
        assert.equal(rescued, false, 'test cleanup had to rescue a leaked descendant');
        assert.equal(alive(pid), false, 'timed-out Git descendant remains alive');
    } finally {
        clearTimeout(rescue); process.env.PATH = previous;
        try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch {}
    }
});
