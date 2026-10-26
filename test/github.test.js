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
