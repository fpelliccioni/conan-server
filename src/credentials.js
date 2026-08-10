// Whether a credential can actually publish, asked before we accept anything.
//
// This server never checked. `authenticate` returned the password back to the
// client as its Conan token and `check_credentials` returned 200 unconditionally
// — for any username, any password, any bearer string. A `conan remote login`
// with an expired PAT printed "Authenticated in remote 'kth'" and every file of
// the upload that followed was answered 200.
//
// The credential is only ever exercised much later, when the staged upload is
// pushed to GitHub, and until recently that failure was swallowed and the
// staging deleted. So an expired token looked exactly like a successful release
// in which the package merely failed to exist. That is utxo-z#92.
//
// The question asked here is not "is this a token" but "can this token do the
// thing this server is going to do with it": push to ${OWNER}/${REPO}. Anything
// weaker still lets through credentials that will fail at push time, which is
// the failure being prevented.
//
// It is asked without writing. `permissions.push` is GitHub's own answer about
// this token on this repository — the same permission `updateRef` will need.
// Validating by creating a commit would put the validation path into the
// package repository's history and race with real publications, so it is not
// done, at login or anywhere else.

import crypto from 'crypto';


export const VALID = 'valid';
export const INVALID = 'invalid';
export const FORBIDDEN = 'forbidden';
export const UNKNOWN = 'unknown';

const GITHUB = 'https://api.github.com';

/**
 * Ask GitHub whether this credential can push to owner/repo.
 *
 * Three outcomes, and they are not interchangeable:
 *
 *   VALID      GitHub knows the token and says it may write        -> 200
 *   INVALID    GitHub says the token is not a credential           -> 401
 *   FORBIDDEN  the token is real and may not write here            -> 403
 *   UNKNOWN    GitHub could not be asked                           -> 503
 *
 * UNKNOWN is the one that matters most. Answering 401 when GitHub is
 * unreachable sends somebody to rotate a PAT that is perfectly fine; answering
 * 200 accepts an upload we may then be unable to publish, which is the whole
 * failure. It is refused, with a status that reads as "try again".
 */
export async function validateCredential(secret, options = {}) {
    const {
        owner = process.env.OWNER,
        repo = process.env.REPO,
        fetchImpl = fetch,
        timeoutMs = 10000,
    } = options;

    if ( ! secret) {
        return { outcome: INVALID, status: 401, why: 'no credential was supplied' };
    }
    if ( ! owner || ! repo) {
        return { outcome: UNKNOWN, status: 503, why: 'the server does not know which repository to check against' };
    }

    const headers = {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'conan-server',
    };

    let who;
    try {
        who = await get(fetchImpl, `${GITHUB}/user`, headers, timeoutMs);
    } catch (err) {
        return { outcome: UNKNOWN, status: 503, why: `GitHub could not be reached: ${err.message}` };
    }
    if (who.status === 401) {
        return { outcome: INVALID, status: 401, why: 'the credential is not a valid GitHub token' };
    }
    if ( ! who.ok) {
        return { outcome: UNKNOWN, status: 503, why: `GitHub answered ${who.status} for the identity check` };
    }

    let permissions;
    let login;
    try {
        login = (await who.json())?.login;
        const target = await get(fetchImpl, `${GITHUB}/repos/${owner}/${repo}`, headers, timeoutMs);

        // 404 is unambiguous: a fine-grained token whose scope does not include
        // this repository is told the repository does not exist. Reading that as
        // "gone" rather than as "not yours" would report a permissions problem
        // as a server fault.
        if (target.status === 404) {
            return {
                outcome: FORBIDDEN,
                status: 403,
                login,
                why: `the credential cannot see ${owner}/${repo}; if it is a fine-grained token, that repository is probably not in its scope`,
            };
        }
        if (target.status === 401) {
            return { outcome: INVALID, status: 401, why: 'the credential is not a valid GitHub token' };
        }
        // 403 is not one thing. GitHub uses it for a primary rate limit, for a
        // secondary "abuse" limit, for an SSO authorisation that has not been
        // granted, and for an ordinary permission denial. Only the last is a
        // fact about what this credential may do; the rate limits are transient
        // and reporting them as "no write access" sends somebody to rotate a
        // perfectly good PAT. So a 403 is classified from what came with it, and
        // anything that cannot be read is Unknown rather than a refusal.
        if (target.status === 403) {
            return await classifyForbidden(target, owner, repo, login);
        }
        if ( ! target.ok) {
            return { outcome: UNKNOWN, status: 503, why: `GitHub answered ${target.status} for the repository check` };
        }
        permissions = (await target.json())?.permissions;
    } catch (err) {
        return { outcome: UNKNOWN, status: 503, why: `GitHub could not be reached: ${err.message}` };
    }

    if ( ! permissions || permissions.push !== true) {
        return {
            outcome: FORBIDDEN,
            status: 403,
            login,
            why: `the credential has no write access to ${owner}/${repo}`,
        };
    }

    return { outcome: VALID, status: 200, login };
}

// What a 403 from GitHub actually meant.
//
// Rate limiting and SSO are told apart by headers, which are cheap and reliable;
// the secondary limit announces itself only in the body. What is left over is
// not assumed to be a permission denial, because the cost of being wrong is
// asymmetric: calling a rate limit "no write access" makes somebody rotate a
// working credential, while calling a permission denial "unknown" only makes the
// client retry and see the same thing.
async function classifyForbidden(response, owner, repo, login) {
    const header = (name) => {
        try {
            return response.headers?.get?.(name) ?? undefined;
        } catch {
            return undefined;
        }
    };

    if (header('x-ratelimit-remaining') === '0') {
        return { outcome: UNKNOWN, status: 503, why: 'GitHub rate limit reached; the credential was not checked' };
    }
    if (header('retry-after')) {
        return { outcome: UNKNOWN, status: 503, why: 'GitHub asked us to back off; the credential was not checked' };
    }

    // SSO is not transient and it does name itself, so it is a definite answer:
    // this credential may not be used against this organisation until it is
    // authorised.
    if (header('x-github-sso')) {
        return {
            outcome: FORBIDDEN,
            status: 403,
            login,
            why: `the credential has not been authorised for the organisation owning ${owner}/${repo} (SSO)`,
        };
    }

    // The secondary limit announces itself only in the body, so it is read —
    // and a body that cannot be read is not allowed to turn into a refusal.
    let body = '';
    try {
        body = typeof response.text === 'function' ? await response.text() : '';
    } catch {
        body = '';
    }
    if (/secondary rate limit|abuse detection/i.test(body)) {
        return { outcome: UNKNOWN, status: 503, why: 'GitHub secondary rate limit; the credential was not checked' };
    }

    return {
        outcome: UNKNOWN,
        status: 503,
        why: `GitHub answered 403 for ${owner}/${repo} without saying why; the credential was not established either way`,
    };
}

async function get(fetchImpl, url, headers, timeoutMs) {
    // A GitHub that accepts the connection and never answers would hold an
    // upload handler open indefinitely, so the wait is bounded and a timeout
    // surfaces as Unknown rather than as a rejection.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
        return await fetchImpl(url, { headers, signal: abort.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * A cache of validation results, keyed by a hash of the credential.
 *
 * Without it, validating costs two GitHub calls per request — a package with
 * forty files would spend eighty calls against a 5000/hour budget just proving
 * the same token twice per file.
 *
 * The key is a SHA-256 of the credential and never the credential. A cache is a
 * structure that gets logged, dumped and inspected, and the values it holds are
 * GitHub PATs with write access to the package repository.
 *
 * Positive and negative results expire on separate clocks. A short positive TTL
 * bounds how long a revoked token keeps working; a negative TTL exists at all so
 * that a client retrying with a bad credential does not hammer the API, and is
 * shorter so that fixing the credential takes effect quickly. UNKNOWN is never
 * cached: it is not a fact about the credential.
 */
export function createCredentialCache(options = {}) {
    const {
        positiveTtlMs = 300000,
        negativeTtlMs = 60000,
        now = () => Date.now(),
    } = options;

    const entries = new Map();

    // Validations in progress, so that concurrent requests carrying the same
    // credential wait on one answer instead of each asking for their own.
    //
    // The cache alone does not prevent this: a Conan upload opens its files at
    // once, so forty PUTs arrive with an empty cache, all miss, and all call
    // GitHub — eighty requests to establish one fact, against a 5000/hour
    // budget, every time a package is published.
    const inFlight = new Map();

    const keyFor = (secret) => crypto.createHash('sha256').update(secret).digest('hex');

    return {
        get(secret) {
            if ( ! secret) return undefined;
            const entry = entries.get(keyFor(secret));
            if ( ! entry) return undefined;
            if (now() >= entry.expiresAt) {
                entries.delete(keyFor(secret));
                return undefined;
            }
            return entry.result;
        },

        set(secret, result) {
            if ( ! secret) return;
            if (result.outcome === UNKNOWN) return;
            const ttl = result.outcome === VALID ? positiveTtlMs : negativeTtlMs;
            entries.set(keyFor(secret), { result, expiresAt: now() + ttl });
        },

        /**
         * The validation of this credential: cached, already running, or begun
         * here. `produce` is called at most once per credential in flight.
         */
        async resolve(secret, produce) {
            const cached = this.get(secret);
            if (cached) return cached;

            const key = keyFor(secret);
            const running = inFlight.get(key);
            if (running) return running;

            const attempt = (async () => {
                const result = await produce(secret);
                this.set(secret, result);
                return result;
            })();

            // Removed on settle rather than on success: a validation that threw
            // must not wedge every later request behind a promise that will
            // never resolve again.
            inFlight.set(key, attempt);
            try {
                return await attempt;
            } finally {
                inFlight.delete(key);
            }
        },

        inFlightCount() {
            return inFlight.size;
        },

        // For tests and for a future status endpoint: how many credentials are
        // remembered, never which.
        size() {
            return entries.size;
        },

        keys() {
            return [...entries.keys()];
        },
    };
}

/**
 * The credential out of an Authorization header, or undefined.
 *
 * Conan sends Basic on `authenticate` and Bearer on everything after it, and the
 * token it sends as Bearer is the password this server handed back. Both carry
 * the same secret and both are accepted.
 *
 * A missing header returns undefined rather than throwing. Destructuring the old
 * getAuth's undefined is what made an anonymous request a 500 with a stack
 * trace, on a public server.
 */
export function credentialFrom(authHeader) {
    if ( ! authHeader || typeof authHeader !== 'string') return undefined;

    const [scheme, value] = authHeader.split(' ');
    if ( ! value) return undefined;

    if (scheme === 'Bearer') return value;
    if (scheme === 'Basic') {
        const decoded = Buffer.from(value, 'base64').toString();
        const separator = decoded.indexOf(':');
        if (separator < 0) return undefined;
        // Everything after the first colon: a password may legitimately contain
        // one, and splitting on every colon would silently truncate it.
        return decoded.slice(separator + 1) || undefined;
    }
    return undefined;
}

/**
 * The guard every writing path goes through, and the login too.
 *
 * Returns the credential when it may write, and otherwise answers the request
 * and returns undefined — so a caller reads as:
 *
 *     const secret = await guard(req, res);
 *     if ( ! secret) return;
 *
 * Checking only at login would leave the upload handlers reachable by a client
 * that never logged in, or whose token was revoked halfway through a long
 * upload. Those handlers are the ones that answer 200 for bytes the server may
 * then be unable to publish, which is the failure being prevented, so they are
 * guarded too. With the cache that costs one map lookup per file.
 */
export function createWriteGuard(options = {}) {
    const {
        validate = validateCredential,
        cache = createCredentialCache(),
        log = console,
        writeCommonHeaders = () => {},
    } = options;

    return async function guard(req, res) {
        const secret = credentialFrom(req.header('Authorization'));
        if ( ! secret) {
            // 401. This is where an anonymous request used to produce a 500 with
            // a stack trace, on a public server.
            writeCommonHeaders(res);
            res.status(401).json({ errors: [{ status: 401, message: 'Authentication required.' }] });
            return undefined;
        }

        const result = await cache.resolve(secret, validate);

        if (result.outcome === VALID) return secret;

        // The reason goes to the client because the client is the only one who
        // can act on it, and a bare 401 is what made this take weeks to find.
        // The credential is never echoed back or logged.
        log.error(`[auth] refused ${req.method} ${req.path}: ${result.why}`);
        writeCommonHeaders(res);
        res.status(result.status).json({ errors: [{ status: result.status, message: result.why }] });
        return undefined;
    };
}
