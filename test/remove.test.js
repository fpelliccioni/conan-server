import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { once } from 'node:events';
import { removeBinaryFromRepo, refreshReadClone } from '../src/github.js';
import { binaryPath, packageRevisions, registerBinaryRoutes } from '../src/remove.js';
import { createStagingPublisher } from '../src/publish.js';

const exec = promisify(execFile);
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = async (cwd, ...args) => (await exec('git', ['-c', 'user.name=Test', '-c',
    'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, env: gitEnv })).stdout.trim();
const target = { recipe_name: 'sample', version: '1.0', revision: 'rrev', package_id: 'id', package_revision: 'new' };

async function fixture(t) {
    const root = await mkdtemp(path.join(tmpdir(), 'conan-removal-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const remote = path.join(root, 'remote.git'), seed = path.join(root, 'seed'), read = path.join(root, 'read');
    await mkdir(seed);
    await git(root, 'init', '--bare', '--initial-branch=master', remote);
    await git(seed, 'init', '--initial-branch=master');
    async function put(relative, contents) {
        const file = path.join(seed, relative); await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, contents);
    }
    await put('sample/1.0/latest.json', '{"revision":"rrev","time":"2026-01-01T00:00:00Z"}');
    await put('sample/1.0/rrev/conanfile.py', 'recipe preserved');
    await put('sample/1.0/rrev/conan_sources.tgz', 'sources preserved');
    await put('sample/2.0/keep.txt', 'other release');
    for (const [id, prev, seconds] of [['id','old',100], ['id','new',200], ['other','keep',300]]) {
        const base = `sample/1.0/rrev/packages/${id}`;
        await put(`${base}/${prev}/conanmanifest.txt`, `${seconds}\n`);
        await put(`${base}/${prev}/conaninfo.txt`, '[settings]\nos=Linux\n');
        await put(`${base}/${prev}/conan_package.tgz`, `binary ${prev}`);
        await put(`${base}/latest.json`, JSON.stringify({ revision: prev, time: new Date(seconds * 1000).toISOString() }));
    }
    await git(seed, 'add', '.'); await git(seed, 'commit', '-m', 'Fixture');
    await git(seed, 'push', remote, 'master'); await git(root, 'clone', remote, read);
    const remove = entry => removeBinaryFromRepo('fixture-secret', entry, 'fixture', 'packages', 'master',
        { remoteUrl: remote, objectSource: read });
    const show = file => git(root, '--git-dir', remote, 'show', `master:${file}`);
    return { root, remote, seed, read, remove, show };
}

async function preserved(f) {
    assert.equal(await f.show('sample/1.0/rrev/conanfile.py'), 'recipe preserved');
    assert.equal(await f.show('sample/1.0/rrev/conan_sources.tgz'), 'sources preserved');
    assert.equal(await f.show('sample/2.0/keep.txt'), 'other release');
    assert.equal(JSON.parse(await f.show('sample/1.0/latest.json')).revision, 'rrev');
}

test('deleting a binary revision updates latest and preserves sources and siblings', async t => {
    const f = await fixture(t);
    await f.remove(target); await refreshReadClone(f.read);
    const parent = 'sample/1.0/rrev/packages/id';
    assert.equal(JSON.parse(await f.show(`${parent}/latest.json`)).revision, 'old');
    assert.deepEqual((await packageRevisions(path.join(f.read, parent))).map(p => p.revision), ['old']);
    await assert.rejects(f.show(`${parent}/new/conan_package.tgz`));
    await f.remove({ ...target, package_revision: 'old' }); await refreshReadClone(f.read);
    await assert.rejects(f.show(`${parent}/latest.json`));
    assert.equal(await f.show('sample/1.0/rrev/packages/other/keep/conan_package.tgz'), 'binary keep');
    await preserved(f);
});

test('bulk binary removal does not remove the recipe or its sources', async t => {
    const f = await fixture(t);
    await f.remove({ recipe_name: 'sample', version: '1.0', revision: 'rrev' });
    await assert.rejects(f.show('sample/1.0/rrev/packages/other/keep/conan_package.tgz'));
    await preserved(f);
});

test('a rejected deletion push leaves the remote and read clone unchanged', async t => {
    const f = await fixture(t);
    await writeFile(path.join(f.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    await assert.rejects(f.remove(target));
    assert.equal(await f.show('sample/1.0/rrev/packages/id/new/conan_package.tgz'), 'binary new');
    assert.equal(await readFile(path.join(f.read, binaryPath(target), 'conan_package.tgz'), 'utf8'), 'binary new');
    await preserved(f);
});

test('missing binaries, traversal and symbolic metadata cannot change recipes', async t => {
    const f = await fixture(t);
    await assert.rejects(f.remove({ ...target, package_revision: 'missing' }), { status: 404 });
    for (const name of ['../source', '.git', 'a/b', 'a\\b'])
        assert.throws(() => binaryPath({ ...target, package_revision: name }), { status: 400 });
    const metadata = path.join(f.seed, 'sample/1.0/rrev/packages/id/latest.json');
    await rm(metadata); await symlink('../../conanfile.py', metadata);
    await git(f.seed, 'add', '.'); await git(f.seed, 'commit', '-m', 'Invalid metadata');
    await git(f.seed, 'push', f.remote, 'master');
    await assert.rejects(f.remove(target), { status: 400 });
    assert.equal(await f.show('sample/1.0/rrev/packages/id/new/conan_package.tgz'), 'binary new');
    await preserved(f);
});

test('HTTP revisions and authenticated DELETE reflect durable Git changes', async t => {
    const f = await fixture(t);
    const app = express();
    const publisher = createStagingPublisher({}, { capacity: 4 });
    registerBinaryRoutes(app, {
        async authorize(req, res) {
            if (!req.headers.authorization) { res.status(401).send(); return; }
            if (req.headers.authorization !== 'Bearer fixture') { res.status(403).send(); return; }
            return 'fixture-secret';
        },
        run: operation => publisher.run(operation), remove: (_, entry) => f.remove(entry),
        refresh: () => refreshReadClone(f.read), root: () => f.read, headers() {},
    });
    app.use((error, req, res, next) => res.status(500).send('failed'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { await publisher.close(); await new Promise(resolve => server.close(resolve)); });
    const base = `http://127.0.0.1:${server.address().port}/api/v2/conans/sample/1.0/_/_/revisions/rrev/packages/id/revisions`;
    assert.deepEqual((await (await fetch(base)).json()).revisions.map(p => p.revision), ['new', 'old']);
    assert.equal((await fetch(`${base}/new`, { method: 'DELETE' })).status, 401);
    assert.equal((await fetch(`${base}/new`, { method: 'DELETE', headers: { authorization: 'Bearer denied' } })).status, 403);
    assert.equal((await fetch(`${base}/new`, { method: 'DELETE', headers: { authorization: 'Bearer fixture' } })).status, 200);
    assert.deepEqual((await (await fetch(base)).json()).revisions.map(p => p.revision), ['old']);
    assert.equal((await fetch(`${base}/new`, { method: 'DELETE', headers: { authorization: 'Bearer fixture' } })).status, 404);
    await preserved(f);
});
