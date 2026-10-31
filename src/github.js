import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, copyFile, chmod, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { redactSecret } from './redact.js';

dotenv.config();

// GitHub's JSON blob endpoint rejects large base64 requests before the normal
// Git file-size limit. Send a Git pack instead, without touching the read clone.
// A competing publication is never overwritten: a non-fast-forward push fails
// and publishStaging retains the upload for an explicit retry.
export async function uploadToRepo(token, uploadPath, owner, repo, branch, message, options = {}) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
        throw new Error('Invalid GitHub repository');
    }
    const work = await mkdtemp(path.join(tmpdir(), 'conan-publish-'));
    const checkout = path.join(work, 'checkout');
    const askpass = path.join(work, 'askpass');
    const inherited = repositoryEnvironment();
    const env = { ...inherited, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass,
        CONAN_GIT_TOKEN: token, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    // Credentials travel through the child environment, never the URL or argv.
    const git = async (...args) => (await executeGit(args, {
        cwd: checkout, env, timeoutMs: options.timeoutMs ?? 300_000,
        killGraceMs: options.killGraceMs ?? 1000,
    })).trim();
    try {
        await mkdir(checkout);
        await writeFile(askpass, '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" x-access-token ;; *) printf "%s\\n" "$CONAN_GIT_TOKEN" ;; esac\n', { mode: 0o700 });
        await git('check-ref-format', `refs/heads/${branch}`);
        const remote = options.remoteUrl ?? `https://github.com/${owner}/${repo}.git`;
        const objectSource = options.objectSource ?? process.env.GIT_REPO_DIR;
        if (objectSource) {
            // Share immutable objects, never the read clone's index or checkout.
            // Fetch negotiation now asks only for commits absent from this cache.
            await git('clone', '--shared', '--no-checkout', '--', objectSource, '.');
            await git('remote', 'set-url', 'origin', remote);
        } else {
            await git('init');
            await git('remote', 'add', 'origin', remote);
        }
        // Do not materialize every other package just to publish one version.
        await git('sparse-checkout', 'init', '--cone');
        await git('sparse-checkout', 'set', '--', ...await uploadPrefixes(uploadPath));
        await git('-c', 'credential.helper=', 'fetch', '--depth=1', 'origin', `refs/heads/${branch}`);
        await git('checkout', '--detach', 'FETCH_HEAD');
        await copyUpload(uploadPath, checkout);
        await git('add', '--all', '--force', '--', '.');
        try {
            await git('diff', '--cached', '--quiet');
            return; // Identical retry: the remote already contains this upload.
        } catch (err) {
            if (err.code !== 1) throw err;
        }
        await git('-c', 'user.name=Conan package publisher', '-c', 'user.email=packages@kth.cash',
            '-c', 'commit.gpgsign=false', 'commit', '-m', message);
        await git('-c', 'credential.helper=', 'push', 'origin', `HEAD:refs/heads/${branch}`);
    } catch (err) {
        // Expose only a redacted diagnostic; credentials stay in the child environment.
        throw new Error(redactSecret(err.message, token));
    } finally {
        await rm(work, { recursive: true, force: true });
    }
}

async function copyUpload(source, destination) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
        if (entry.name.toLowerCase() === '.git' || entry.isSymbolicLink()) {
            throw new Error('Upload contains a reserved path or symbolic link');
        }
        const from = path.join(source, entry.name);
        const to = path.join(destination, entry.name);
        if (entry.isDirectory()) {
            await mkdir(to, { recursive: true });
            await copyUpload(from, to);
        } else if (entry.isFile()) {
            await copyFile(from, to);
            await chmod(to, 0o644);
        } else {
            throw new Error('Upload contains an unsupported file');
        }
    }
}

// The process group owns Git's remote helpers and pack writers. Killing only
// the initial `git` leaves them downloading into already-unlinked pack files.
function executeGit(args, { cwd, env, timeoutMs, killGraceMs }) {
    return new Promise((resolve, reject) => {
        const grouped = process.platform !== 'win32';
        const child = spawn('git', args, { cwd, env, detached: grouped,
            stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '', bytes = 0;
        let failure, closed = false, terminated = false, grace;
        let exitCode, exitSignal;
        const signal = value => {
            if (!child.pid) return;
            try {
                if (grouped) process.kill(-child.pid, value);
                else child.kill(value);
            } catch (err) { if (err.code !== 'ESRCH') failure ??= err; }
        };
        const finish = () => {
            if (!closed || (failure && !terminated)) return;
            clearTimeout(timer);
            if (failure || exitCode !== 0) {
                const detail = failure?.message ?? `Git exited with ${exitCode ?? exitSignal}`;
                const error = new Error(`${detail}: git ${args.join(' ')}\n${stderr}`);
                error.code = failure?.code ?? exitCode;
                error.signal = exitSignal;
                reject(error);
            } else resolve(stdout);
        };
        const stop = error => {
            if (failure) return;
            failure = error;
            signal('SIGTERM');
            // Retain this timer even if the parent exits first: a descendant
            // may ignore SIGTERM and have no inherited stdout/stderr pipes.
            grace = setTimeout(() => {
                signal('SIGKILL'); terminated = true; finish();
            }, killGraceMs);
        };
        const timer = setTimeout(() => stop(new Error(`Git timed out after ${timeoutMs} ms`)), timeoutMs);
        for (const [stream, append] of [[child.stdout, text => { stdout += text; }],
                                       [child.stderr, text => { stderr += text; }]]) {
            stream.on('data', chunk => {
                bytes += chunk.length;
                if (bytes > 1024 * 1024) stop(new Error('Git output exceeded 1 MiB'));
                else append(chunk.toString());
            });
        }
        child.on('error', err => {
            failure = err; closed = true; terminated = true;
            clearTimeout(grace); finish();
        });
        child.on('close', (code, value) => {
            closed = true; exitCode = code; exitSignal = value; finish();
        });
    });
}

async function uploadPrefixes(source) {
    const prefixes = [];
    for (const entry of await readdir(source, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const versions = (await readdir(path.join(source, entry.name), { withFileTypes: true }))
            .filter(child => child.isDirectory());
        if (!versions.length) prefixes.push(entry.name);
        else for (const version of versions) prefixes.push(`${entry.name}/${version.name}`);
    }
    return prefixes;
}

function repositoryEnvironment() {
    const variables = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE',
        'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR',
        'GIT_PREFIX', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];
    return Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !variables.includes(key)));
}

// Refresh uses the same process ownership and absolute deadlines as upload.
// A silent pull must not indefinitely hold the serial publication owner.
export async function refreshReadClone(directory, options = {}) {
    const settings = { cwd: directory, env: { ...repositoryEnvironment(),
        GIT_TERMINAL_PROMPT: '0' }, timeoutMs: options.timeoutMs ?? 120_000,
        killGraceMs: options.killGraceMs ?? 1000 };
    const status = await executeGit(['status', '--porcelain'], settings);
    if (status.trim()) throw new Error('Read clone has local changes; refusing to update it');
    return executeGit(['pull', '--ff-only'], settings);
}
