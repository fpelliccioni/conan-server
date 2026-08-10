// What happens to a staged upload when publishing it does not work.
//
// Every case here is a way utxo-z#92 happened or could happen again. The server
// answered 200 for each file, the client left, and the only copy of the package
// is the staging directory — so the question each test asks is the same one:
// after this failure, are the bytes still there?
//
// The real failures cannot be arranged on demand. GitHub cannot be asked to
// reject a token on cue, and a pull cannot be made to fail while a push
// succeeds. So the two are injected, and the code under test runs its real
// logic against them.
//
// Run:  node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { publishStaging, PUBLISHED, KEPT } from '../src/publish.js';
import { redactSecret, messageOf } from '../src/redact.js';

// The two PRs each grew their own copy of this; they are one helper now, and
// these cases follow it rather than being dropped.
const redact = (err, secret) => redactSecret(messageOf(err), secret);

const TOKEN = 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const ENTRY = {
    token: TOKEN,
    owner: 'k-nuth',
    repo: 'conan-packages',
    branch: 'master',
    recipe_name: 'utxoz',
    version: '0.9.0',
    revision: '1641e7744f1438ccd2df44b78703d378',
    tmpDir: '/srv/tmp/upload-Ab12Cd',
    uploadPath: '/srv/tmp/upload-Ab12Cd/k-nuth/conan-packages/master',
    commitMessage: 'Upload utxoz/0.9.0 revision 1641e7744f1438ccd2df44b78703d378.',
};

// A recorder standing in for everything that touches the world.
function harness(overrides = {}) {
    const removed = [];
    const lines = [];
    const deps = {
        uploadToRepo: overrides.uploadToRepo ?? (async () => {}),
        performGithubPull: overrides.performGithubPull ?? (async () => {}),
        removeStaging: overrides.removeStaging ?? (async (dir) => { removed.push(dir); }),
        log: {
            info: (m) => lines.push(m),
            error: (m) => lines.push(m),
        },
    };
    return { deps, removed, lines, said: () => lines.join('\n') };
}

test('a push that fails keeps the staging', async () => {
    const h = harness({
        uploadToRepo: async () => { throw new Error('HttpError: Bad credentials'); },
    });

    const result = await publishStaging(h.deps, ENTRY);

    assert.equal(result.outcome, KEPT);
    assert.deepEqual(h.removed, [], 'nothing may be deleted when the push failed');
    assert.match(h.said(), /NOT published/);
    assert.match(h.said(), /staging kept at \/srv\/tmp\/upload-Ab12Cd/);
});

// The exact shape of #92: an expired or unprivileged credential. The server
// accepted it at login because it accepts anything, and GitHub is the first
// thing in the chain to disagree.
test('a rejected credential keeps the staging and says so', async () => {
    const h = harness({
        uploadToRepo: async () => {
            const err = new Error('HttpError: Bad credentials');
            err.status = 401;
            throw err;
        },
    });

    const result = await publishStaging(h.deps, ENTRY);

    assert.equal(result.outcome, KEPT);
    assert.equal(result.reason, 'the push to GitHub failed');
    assert.deepEqual(h.removed, []);
    assert.match(h.said(), /utxoz\/0\.9\.0#1641e7744f1438ccd2df44b78703d378/,
        'the log has to name the reference, or the staging cannot be matched to an upload');
});

// The commit is on GitHub and the local clone is not. Reads are served from the
// clone, so the package exists and is invisible — and deleting the staging then
// would destroy the copy that could still be republished.
test('a pull that fails keeps the staging', async () => {
    const h = harness({
        performGithubPull: async () => { throw new Error('fatal: could not read from remote'); },
    });

    const result = await publishStaging(h.deps, ENTRY);

    assert.equal(result.outcome, KEPT);
    assert.deepEqual(h.removed, []);
    assert.match(h.said(), /pushed but the local clone could not be updated/);
});

test('a publication that works removes the staging', async () => {
    const h = harness();

    const result = await publishStaging(h.deps, ENTRY);

    assert.equal(result.outcome, PUBLISHED);
    assert.deepEqual(h.removed, [ENTRY.tmpDir], 'the staging is removed exactly once, and only on success');
    assert.match(h.said(), /published; staging removed/);
});

test('the pull is not attempted when the push failed', async () => {
    let pulled = 0;
    const h = harness({
        uploadToRepo: async () => { throw new Error('boom'); },
        performGithubPull: async () => { pulled += 1; },
    });

    await publishStaging(h.deps, ENTRY);

    assert.equal(pulled, 0, 'there is nothing to pull when nothing was pushed');
});

// The removal is filesystem work and it can fail. The callback form of fs.rm
// returned before it had happened and told nobody but the console, so the caller
// could announce "staging removed" over a directory that was still there.
test('a removal that fails is reported, and the package is still published', async () => {
    const h = harness({
        removeStaging: async () => { throw new Error('EACCES: permission denied'); },
    });

    const result = await publishStaging(h.deps, ENTRY);

    assert.equal(result.outcome, PUBLISHED, 'the push and the pull both worked; the package is published');
    assert.equal(result.stage, KEPT, 'the directory is still on disk and the result has to say so');
    assert.match(h.said(), /staging could not be removed/);
    assert.match(h.said(), /only leftover/, 'leftover staging must not read like a lost upload');
});

// Announcing the removal before it has happened is the specific bug: the
// callback form let the log and the return value run ahead of the filesystem.
test('the removal is awaited before anything is claimed about it', async () => {
    const order = [];
    const h = harness({
        removeStaging: async () => {
            order.push('removal starts');
            await new Promise((resolve) => setTimeout(resolve, 5));
            order.push('removal finishes');
        },
    });
    const log = h.deps.log.info;
    h.deps.log.info = (m) => { order.push('claimed'); log(m); };

    await publishStaging(h.deps, ENTRY);

    assert.deepEqual(order, ['removal starts', 'removal finishes', 'claimed'],
        'the success was announced before the directory was gone');
});

test('a removal that fails does not hide a push that worked', async () => {
    let pushed = 0;
    const h = harness({
        uploadToRepo: async () => { pushed += 1; },
        removeStaging: async () => { throw new Error('EBUSY'); },
    });

    const result = await publishStaging(h.deps, ENTRY);

    assert.equal(pushed, 1);
    assert.equal(result.outcome, PUBLISHED);
});

test('the order is push, then pull, then remove', async () => {
    const order = [];
    const h = harness({
        uploadToRepo: async () => { order.push('push'); },
        performGithubPull: async () => { order.push('pull'); },
    });
    h.deps.removeStaging = async () => { order.push('remove'); };

    await publishStaging(h.deps, ENTRY);

    assert.deepEqual(order, ['push', 'pull', 'remove']);
});

// A log is a file, a terminal, and eventually a paste into a bug report. The
// credential is a GitHub PAT with write access to the package repository, and
// Octokit puts the failing request into the error it throws.
test('the credential never reaches the log', async () => {
    const h = harness({
        uploadToRepo: async () => {
            throw new Error(`request failed: Authorization: Bearer ${TOKEN}`);
        },
    });

    await publishStaging(h.deps, ENTRY);

    assert.equal(h.said().includes(TOKEN), false, 'the token appears in the log');
    assert.match(h.said(), /\[redacted-token\]/);
});

test('redact removes the exact credential it was given', () => {
    const secret = 'a-password-that-is-not-token-shaped';
    const line = redact(new Error(`login failed for ${secret} at host`), secret);

    assert.equal(line.includes(secret), false);
    assert.match(line, /\[redacted-token\]/);
});

// Forty hex characters is both a legacy PAT and a git commit SHA. A rule broad
// enough to catch the first strips the second out of every message it appears
// in, and the SHA is usually the most useful thing in the line.
test('redact leaves git SHAs alone', () => {
    const sha = '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432';
    const line = redact(new Error(`update of ref failed at ${sha}`), TOKEN);

    assert.match(line, new RegExp(sha), 'the commit SHA was removed and it is not a secret');
});

test('redact copes with a missing secret and a non-Error', () => {
    assert.equal(redact('plain string failure', undefined), 'plain string failure');
    assert.equal(redact(new Error('x'), ''), 'x');
});

// A short secret would match everywhere and turn the message into redaction
// markers; the token is never short, so refusing to substring-replace on
// something tiny costs nothing and avoids destroying a log line.
test('redact does not shred a message over a tiny secret', () => {
    const line = redact(new Error('a failure occurred'), 'a');
    assert.equal(line, 'a failure occurred');
});
