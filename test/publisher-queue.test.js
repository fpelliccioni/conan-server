import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStagingPublisher, PUBLISHED, KEPT } from '../src/publish.js';

const entry = id => ({ token: 'fixture-token', owner: 'fixture', repo: 'packages',
    branch: 'master', recipe_name: id, version: '1.0', revision: 'recipe',
    uploadPath: id, tmpDir: `/retained/${id}`, commitMessage: id });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('one owner serializes upload, refresh and cleanup; close joins admitted work', async () => {
    const entered = deferred(), release = deferred();
    const calls = [];
    const publisher = createStagingPublisher({
        async uploadToRepo(token, path) {
            calls.push(`upload:${path}`);
            if (path === 'first') { entered.resolve(); await release.promise; }
        },
        async performGithubPull() { calls.push('refresh'); },
        async removeStaging(path) { calls.push(`remove:${path}`); },
        log: { info() {}, error() {} },
    }, { capacity: 1 });
    const first = publisher.submit(entry('first'));
    await entered.promise;
    const second = publisher.submit(entry('second'));
    const refused = await publisher.submit(entry('overflow'));
    assert.equal(refused.outcome, KEPT);
    assert.deepEqual(calls, ['upload:first']);
    const closing = publisher.close();
    assert.equal((await publisher.submit(entry('after-close'))).outcome, KEPT);
    release.resolve();
    assert.equal((await first).outcome, PUBLISHED);
    assert.equal((await second).outcome, PUBLISHED);
    await closing;
    assert.deepEqual(calls, ['upload:first', 'refresh', 'remove:/retained/first',
        'upload:second', 'refresh', 'remove:/retained/second']);
});

test('a failed publication retains its debt and does not block the next upload', async () => {
    const calls = [];
    const publisher = createStagingPublisher({
        async uploadToRepo(token, path) { if (path === 'failed') throw new Error('refused'); },
        async performGithubPull() { calls.push('refresh'); },
        async removeStaging(path) { calls.push(path); },
        log: { info() {}, error() {} },
    });
    const failed = publisher.submit(entry('failed'));
    const next = publisher.submit(entry('next'));
    assert.equal((await failed).outcome, KEPT);
    assert.equal((await next).outcome, PUBLISHED);
    await publisher.close();
    assert.deepEqual(calls, ['refresh', '/retained/next']);
});
