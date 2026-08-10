// Whether a credential is checked before the server accepts anything.
//
// The server used to answer 200 to `check_credentials` for any username, any
// password and any bearer string, and 500 with a stack trace when the header was
// missing. A `conan remote login` with an expired PAT printed "Authenticated in
// remote 'kth'" and every file of the upload that followed was answered 200; the
// credential was first exercised minutes later, pushing to GitHub, where the
// failure was swallowed. That is utxo-z#92.
//
// GitHub is injected. Its three interesting answers — this is not a token, this
// token may not write here, I cannot answer right now — are exactly the ones a
// real remote will not produce on demand.
//
// Run:  node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

import {
    validateCredential, createCredentialCache, credentialFrom,
    VALID, INVALID, FORBIDDEN, UNKNOWN,
} from '../src/credentials.js';
import { redactSecret } from '../src/redact.js';

const TOKEN = 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WHERE = { owner: 'k-nuth', repo: 'conan-packages' };

// A GitHub that answers what each case needs, and records what it was asked.
function githubThat(replies) {
    const asked = [];
    const fetchImpl = async (url) => {
        asked.push(url);
        const which = url.endsWith('/user') ? 'user' : 'repo';
        const reply = replies[which];
        if (typeof reply === 'function') return reply();
        const headers = new Map(Object.entries(reply.headers ?? {}));
        return {
            ok: reply.status >= 200 && reply.status < 300,
            status: reply.status,
            headers: { get: (name) => headers.get(name.toLowerCase()) },
            json: async () => reply.body ?? {},
            text: async () => reply.text ?? '',
        };
    };
    return { fetchImpl, asked };
}

const CAN_WRITE = { status: 200, body: { permissions: { admin: false, push: true, pull: true } } };
const READ_ONLY = { status: 200, body: { permissions: { admin: false, push: false, pull: true } } };
const IS_USER = { status: 200, body: { login: 'fpelliccioni' } };

test('a token that can push is accepted', async () => {
    const gh = githubThat({ user: IS_USER, repo: CAN_WRITE });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, VALID);
    assert.equal(result.status, 200);
    assert.equal(result.login, 'fpelliccioni');
});

// The likeliest shape of #92: the PAT expired.
test('a token GitHub does not recognise is 401', async () => {
    const gh = githubThat({ user: { status: 401 }, repo: CAN_WRITE });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, INVALID);
    assert.equal(result.status, 401);
    assert.equal(gh.asked.length, 1, 'there is no point asking about the repository once the token is rejected');
});

// The other shape: a live token that lost, or never had, write access. It would
// pass any check that only asked "is this a token".
test('a real token without write access is 403', async () => {
    const gh = githubThat({ user: IS_USER, repo: READ_ONLY });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, FORBIDDEN);
    assert.equal(result.status, 403);
    assert.match(result.why, /no write access/);
});

// A fine-grained token whose scope does not include the repository is told the
// repository does not exist. Reading that as "gone" would report a permissions
// problem as a server fault.
test('a 404 on the repository is a permission problem, not a missing repository', async () => {
    const gh = githubThat({ user: IS_USER, repo: { status: 404 } });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, FORBIDDEN);
    assert.equal(result.status, 403);
    assert.match(result.why, /fine-grained/);
});

// 403 is not one thing. GitHub uses it for a primary rate limit, a secondary
// "abuse" limit, an ungranted SSO authorisation, and an ordinary permission
// denial. Only the last is a fact about the credential, and calling a rate limit
// "no write access" sends somebody to rotate a perfectly good PAT.
test('a bare 403 is unknown, not a refusal', async () => {
    const gh = githubThat({ user: IS_USER, repo: { status: 403 } });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, UNKNOWN);
    assert.equal(result.status, 503);
    assert.match(result.why, /without saying why/);
});

test('a 403 that is the primary rate limit is unknown', async () => {
    const gh = githubThat({
        user: IS_USER,
        repo: { status: 403, headers: { 'x-ratelimit-remaining': '0' } },
    });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, UNKNOWN);
    assert.match(result.why, /rate limit/);
});

test('a 403 asking us to back off is unknown', async () => {
    const gh = githubThat({ user: IS_USER, repo: { status: 403, headers: { 'retry-after': '60' } } });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, UNKNOWN);
    assert.match(result.why, /back off/);
});

test('a 403 that is the secondary limit is unknown, and it only says so in the body', async () => {
    const gh = githubThat({
        user: IS_USER,
        repo: { status: 403, text: '{"message":"You have exceeded a secondary rate limit"}' },
    });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, UNKNOWN);
    assert.match(result.why, /secondary rate limit/);
});

// SSO does name itself and is not transient, so it is a definite answer about
// this credential rather than a condition to retry.
test('a 403 demanding SSO is a refusal', async () => {
    const gh = githubThat({
        user: IS_USER,
        repo: { status: 403, headers: { 'x-github-sso': 'required; url=https://github.com/orgs/k-nuth/sso' } },
    });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, FORBIDDEN);
    assert.equal(result.status, 403);
    assert.match(result.why, /SSO/);
});

test('a 403 whose body cannot be read is still unknown, never a refusal', async () => {
    const gh = githubThat({ user: IS_USER, repo: { status: 403 } });
    const original = gh.fetchImpl;
    const fetchImpl = async (url) => {
        const response = await original(url);
        if ( ! url.endsWith('/user')) response.text = async () => { throw new Error('stream already consumed'); };
        return response;
    };

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl });

    assert.equal(result.outcome, UNKNOWN);
});

test('a repository reply with no permissions block is refused', async () => {
    const gh = githubThat({ user: IS_USER, repo: { status: 200, body: {} } });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, FORBIDDEN);
});

// The outcome that must never collapse into either of the others. Answering 401
// here sends somebody to rotate a PAT that is fine; answering 200 accepts an
// upload that may then be impossible to publish.
test('GitHub being unreachable is 503, not 401', async () => {
    const gh = githubThat({ user: () => { throw new Error('ECONNREFUSED'); }, repo: CAN_WRITE });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, UNKNOWN);
    assert.equal(result.status, 503);
    assert.match(result.why, /could not be reached/);
});

test('GitHub answering 500 is 503, not 401', async () => {
    const gh = githubThat({ user: { status: 500 }, repo: CAN_WRITE });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, UNKNOWN);
    assert.equal(result.status, 503);
});

test('a rate-limited GitHub is 503, not a refusal', async () => {
    const gh = githubThat({ user: IS_USER, repo: { status: 429 } });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, UNKNOWN);
    assert.equal(result.status, 503);
});

test('a request that never returns is bounded and reported as unknown', async () => {
    const gh = githubThat({
        user: () => new Promise((_, reject) => {
            // What fetch does when its AbortSignal fires.
            setTimeout(() => reject(new Error('This operation was aborted')), 5);
        }),
        repo: CAN_WRITE,
    });

    const result = await validateCredential(TOKEN, { ...WHERE, fetchImpl: gh.fetchImpl, timeoutMs: 1 });

    assert.equal(result.outcome, UNKNOWN);
    assert.equal(result.status, 503);
});

test('no credential at all is 401, never a crash', async () => {
    for (const nothing of [undefined, null, '']) {
        const result = await validateCredential(nothing, WHERE);
        assert.equal(result.outcome, INVALID);
        assert.equal(result.status, 401);
    }
});

test('a server that does not know its own repository refuses rather than guesses', async () => {
    const gh = githubThat({ user: IS_USER, repo: CAN_WRITE });

    const result = await validateCredential(TOKEN, { owner: undefined, repo: undefined, fetchImpl: gh.fetchImpl });

    assert.equal(result.outcome, UNKNOWN);
    assert.equal(result.status, 503);
});

// --- the header ------------------------------------------------------------

test('the credential is read from Basic and from Bearer', () => {
    const basic = Buffer.from(`someuser:${TOKEN}`).toString('base64');

    assert.equal(credentialFrom(`Bearer ${TOKEN}`), TOKEN);
    assert.equal(credentialFrom(`Basic ${basic}`), TOKEN);
});

// A password may contain a colon, and splitting on every one of them would hand
// GitHub a truncated token and report a perfectly good credential as invalid.
test('a credential containing a colon survives Basic decoding', () => {
    const awkward = 'ghp_has:colons:inside';
    const basic = Buffer.from(`someuser:${awkward}`).toString('base64');

    assert.equal(credentialFrom(`Basic ${basic}`), awkward);
});

// This is what returned 500 with a stack trace to anonymous callers on a public
// server: destructuring the old getAuth's undefined.
test('a missing or malformed header yields nothing rather than throwing', () => {
    for (const header of [undefined, null, '', 'Bearer', 'Basic', 'Weird abc', 42]) {
        assert.equal(credentialFrom(header), undefined);
    }
    const noColon = Buffer.from('nocolonhere').toString('base64');
    assert.equal(credentialFrom(`Basic ${noColon}`), undefined);
});

// --- the cache -------------------------------------------------------------

test('a validated credential is not revalidated within its TTL', async () => {
    const cache = createCredentialCache({ positiveTtlMs: 1000, now: () => 0 });
    cache.set(TOKEN, { outcome: VALID, status: 200 });

    assert.equal(cache.get(TOKEN).outcome, VALID);
});

test('a positive result expires', async () => {
    let clock = 0;
    const cache = createCredentialCache({ positiveTtlMs: 1000, now: () => clock });
    cache.set(TOKEN, { outcome: VALID, status: 200 });

    clock = 1000;
    assert.equal(cache.get(TOKEN), undefined, 'a revoked token must stop working eventually');
});

// Separate clocks, and the negative one is shorter: a client retrying with a bad
// credential should not hammer the API, but fixing the credential should take
// effect quickly.
test('a refusal expires sooner than an acceptance', () => {
    let clock = 0;
    const cache = createCredentialCache({ positiveTtlMs: 1000, negativeTtlMs: 100, now: () => clock });
    cache.set(TOKEN, { outcome: INVALID, status: 401 });

    clock = 99;
    assert.notEqual(cache.get(TOKEN), undefined);
    clock = 100;
    assert.equal(cache.get(TOKEN), undefined);
});

// Not knowing is not a fact about the credential, so remembering it would keep
// answering 503 after GitHub came back.
test('an unknown result is never cached', () => {
    const cache = createCredentialCache({ now: () => 0 });
    cache.set(TOKEN, { outcome: UNKNOWN, status: 503 });

    assert.equal(cache.get(TOKEN), undefined);
    assert.equal(cache.size(), 0);
});

// A cache is a structure that gets logged, dumped and inspected, and the values
// here are PATs with write access to the package repository.
test('the cache holds a hash of the credential and never the credential', () => {
    const cache = createCredentialCache({ now: () => 0 });
    cache.set(TOKEN, { outcome: VALID, status: 200 });

    const keys = cache.keys();
    assert.equal(keys.length, 1);
    assert.equal(keys[0].includes(TOKEN), false, 'the token is in the cache key');
    assert.equal(keys[0], crypto.createHash('sha256').update(TOKEN).digest('hex'));
});

test('two credentials do not share an entry', () => {
    const cache = createCredentialCache({ now: () => 0 });
    cache.set(TOKEN, { outcome: VALID, status: 200 });
    cache.set('another-token-entirely', { outcome: INVALID, status: 401 });

    assert.equal(cache.get(TOKEN).outcome, VALID);
    assert.equal(cache.get('another-token-entirely').outcome, INVALID);
});

test('the cache ignores an empty credential', () => {
    const cache = createCredentialCache({ now: () => 0 });
    cache.set('', { outcome: VALID, status: 200 });

    assert.equal(cache.get(''), undefined);
    assert.equal(cache.size(), 0);
});

// --- the guard, and where it is wired ---------------------------------------

import { createWriteGuard } from '../src/credentials.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function request(header, method = 'PUT', route = '/api/v2/conans/x') {
    const sent = {};
    return {
        req: { header: (name) => (name === 'Authorization' ? header : undefined), method, path: route },
        res: {
            status(code) { sent.status = code; return this; },
            json(body) { sent.body = body; return this; },
            send(body) { sent.body = body; return this; },
        },
        sent,
    };
}

const guardWith = (result) => createWriteGuard({
    validate: async () => result,
    cache: createCredentialCache({ now: () => 0 }),
    log: { error() {} },
});

test('the guard passes a credential that may write', async () => {
    const guard = guardWith({ outcome: VALID, status: 200 });
    const { req, res, sent } = request(`Bearer ${TOKEN}`);

    assert.equal(await guard(req, res), TOKEN);
    assert.equal(sent.status, undefined, 'a valid credential must not be answered, it must be let through');
});

test('the guard answers 401 with no header and never calls GitHub', async () => {
    let asked = 0;
    const guard = createWriteGuard({
        validate: async () => { asked += 1; return { outcome: VALID, status: 200 }; },
        cache: createCredentialCache({ now: () => 0 }),
        log: { error() {} },
    });
    const { req, res, sent } = request(undefined);

    assert.equal(await guard(req, res), undefined);
    assert.equal(sent.status, 401);
    assert.equal(asked, 0);
});

test('the guard maps each refusal to its own status', async () => {
    for (const [outcome, status] of [[INVALID, 401], [FORBIDDEN, 403], [UNKNOWN, 503]]) {
        const guard = guardWith({ outcome, status, why: 'because' });
        const { req, res, sent } = request(`Bearer ${TOKEN}`);

        assert.equal(await guard(req, res), undefined);
        assert.equal(sent.status, status, `${outcome} should answer ${status}`);
        assert.match(sent.body.errors[0].message, /because/);
    }
});

test('the guard never echoes the credential back to the client', async () => {
    const guard = guardWith({ outcome: INVALID, status: 401, why: 'the credential is not a valid GitHub token' });
    const { req, res, sent } = request(`Bearer ${TOKEN}`);

    await guard(req, res);
    assert.equal(JSON.stringify(sent.body).includes(TOKEN), false);
});

test('the guard validates once and then uses the cache', async () => {
    let asked = 0;
    const guard = createWriteGuard({
        validate: async () => { asked += 1; return { outcome: VALID, status: 200 }; },
        cache: createCredentialCache({ positiveTtlMs: 1000, now: () => 0 }),
        log: { error() {} },
    });

    for (let i = 0; i < 40; i += 1) {
        const { req, res } = request(`Bearer ${TOKEN}`);
        await guard(req, res);
    }

    assert.equal(asked, 1, 'a forty-file upload must not cost forty validations');
});

// Which routes are guarded is the substance of this change, and it is the kind
// of thing a later edit silently undoes: a new upload route, or a `return`
// dropped from the guard line, and the server is back to accepting anything.
// Asserting it against the source is blunt, but it is the only place the fact
// lives — the routes cannot be imported without starting a server and pulling a
// git repository.
test('every writing route and the login are behind the guard', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, '..', 'src', 'index.js'), 'utf8');

    const guarded = [
        "app.get('/api/v2/users/authenticate'",
        "app.get('/api/v2/users/check_credentials'",
        "app.put('/api/v2/conans/:recipe_name/:version/_/_/revisions/:revision/files/:file_name'",
        "app.put('/api/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/revisions/:package_revision/files/:file_name'",
    ];

    for (const route of guarded) {
        const at = source.indexOf(route);
        assert.notEqual(at, -1, `route not found, has it been renamed? ${route}`);
        const body = source.slice(at, at + 600);
        assert.match(body, /requireWriteCredential\(req, res\)/,
            `route is not behind the credential guard: ${route}`);
    }

    // And the count, so a new PUT added later without a guard is caught rather
    // than merely not covered.
    const puts = source.match(/app\.put\(/g) || [];
    assert.equal(puts.length, 2, 'a writing route was added; guard it and update this count');
});

test('the server does not send stack traces to clients', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, '..', 'src', 'index.js'), 'utf8');

    assert.match(source, /app\.use\(\(err, req, res, next\)/, 'there is no error handler, so Express sends its own with the stack');
    const handler = source.slice(source.indexOf('app.use((err, req, res, next)'), source.length).slice(0, 1400);
    assert.match(handler, /Internal server error/);
});

// An error thrown out of a request carries whatever the library that threw it
// attached, and for an HTTP client that is routinely the request it failed on.
// Logging `err.stack` reads as if it could only contain frames.
test('the error handler redacts before it logs, and never logs the error whole', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, '..', 'src', 'index.js'), 'utf8');
    const handler = source.slice(source.indexOf('app.use((err, req, res, next)')).slice(0, 1400);

    assert.match(handler, /redactSecret\(/, 'the error handler logs without redacting');
    assert.doesNotMatch(handler, /console\.error\(`\[error\][^`]*\$\{err[.\s]/,
        'the error is interpolated straight into the log line');
});

// The regression proper: a credential embedded in what the handler would log.
test('a credential inside an error never reaches the log', () => {
    const err = new Error(
        `HttpError: Bad credentials - https://api.github.com/repos/k-nuth/conan-packages\n` +
        `  request: { headers: { authorization: 'token ${TOKEN}', accept: 'application/vnd.github+json' } }`
    );

    const line = redactSecret(err.stack, TOKEN);

    assert.equal(line.includes(TOKEN), false, 'the credential is in the log line');
    assert.match(line, /\[redacted-token\]/);
    assert.match(line, /Bad credentials/, 'redaction must not destroy the diagnosis');
});

// A legacy PAT is forty hex characters, and the shape patterns deliberately do
// not match that — a git commit SHA looks identical, and stripping those would
// gut every message they appear in. So this credential is caught by exactly one
// mechanism: removing the value we were given. Without it, it goes to the log.
test('a credential the patterns cannot recognise is still removed', () => {
    const legacy = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const err = new Error(
        `HttpError: Bad credentials\n  request: { headers: { authorization: 'token ${legacy}' } }`
    );

    const line = redactSecret(err.stack, legacy);

    assert.equal(line.includes(legacy), false, 'a legacy PAT reached the log');
    assert.match(line, /Bad credentials/);
});

test('redaction still works when the request had no credential to compare against', () => {
    const line = redactSecret(`authorization: Bearer ${TOKEN}`, undefined);

    assert.equal(line.includes(TOKEN), false, 'the shape backstop did not catch a ghp_ token');
});

test('redaction leaves a git SHA alone', () => {
    const sha = '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432';

    assert.match(redactSecret(`updateRef failed at ${sha}`, TOKEN), new RegExp(sha));
});

// --- concurrency ------------------------------------------------------------

// A Conan upload opens its files at once. Forty PUTs arrive against an empty
// cache, all miss, and without single-flight all forty call GitHub twice — eighty
// requests to establish one fact, every time a package is published.
test('concurrent requests with the same credential validate once', async () => {
    let asked = 0;
    const guard = createWriteGuard({
        validate: async () => {
            asked += 1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { outcome: VALID, status: 200 };
        },
        cache: createCredentialCache({ positiveTtlMs: 10000, now: () => 0 }),
        log: { error() {} },
    });

    const results = await Promise.all(Array.from({ length: 40 }, () => {
        const { req, res } = request(`Bearer ${TOKEN}`);
        return guard(req, res);
    }));

    assert.equal(asked, 1, `40 concurrent requests caused ${asked} validations`);
    assert.deepEqual([...new Set(results)], [TOKEN], 'every waiter must get the same answer');
});

test('concurrent requests with different credentials validate once each', async () => {
    const asked = [];
    const guard = createWriteGuard({
        validate: async (secret) => {
            asked.push(secret);
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { outcome: VALID, status: 200 };
        },
        cache: createCredentialCache({ positiveTtlMs: 10000, now: () => 0 }),
        log: { error() {} },
    });

    await Promise.all(['token-one', 'token-two', 'token-one', 'token-two'].map((t) => {
        const { req, res } = request(`Bearer ${t}`);
        return guard(req, res);
    }));

    assert.equal(asked.length, 2);
    assert.deepEqual([...asked].sort(), ['token-one', 'token-two']);
});

// A validation that throws must not wedge every later request behind a promise
// that will never settle again.
test('a validation that throws does not poison later requests', async () => {
    let asked = 0;
    const cache = createCredentialCache({ now: () => 0 });
    const guard = createWriteGuard({
        validate: async () => {
            asked += 1;
            if (asked === 1) throw new Error('transient');
            return { outcome: VALID, status: 200 };
        },
        cache,
        log: { error() {} },
    });

    const first = request(`Bearer ${TOKEN}`);
    await assert.rejects(() => guard(first.req, first.res));
    assert.equal(cache.inFlightCount(), 0, 'the failed attempt is still registered as in flight');

    const second = request(`Bearer ${TOKEN}`);
    assert.equal(await guard(second.req, second.res), TOKEN);
    assert.equal(asked, 2);
});
