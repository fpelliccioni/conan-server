import dotenv from 'dotenv';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, copyFile, chmod, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { redactSecret } from './redact.js';

dotenv.config();
const exec = promisify(execFile);

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
    const repositoryVariables = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE',
        'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR',
        'GIT_PREFIX', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];
    const inherited = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !repositoryVariables.includes(key)));
    const env = { ...inherited, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass,
        CONAN_GIT_TOKEN: token, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    // Credentials travel through the child environment, never the URL or argv.
    const git = async (...args) => (await exec('git', args, {
        cwd: checkout, env, timeout: 300_000, maxBuffer: 1024 * 1024,
    })).stdout.trim();
    try {
        await mkdir(checkout);
        await writeFile(askpass, '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" x-access-token ;; *) printf "%s\\n" "$CONAN_GIT_TOKEN" ;; esac\n', { mode: 0o700 });
        await git('check-ref-format', `refs/heads/${branch}`);
        await git('init');
        await git('remote', 'add', 'origin', options.remoteUrl ?? `https://github.com/${owner}/${repo}.git`);
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
        // execFile errors contain argv and stderr. Expose only a redacted message.
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
