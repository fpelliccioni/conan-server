// Publishing a staged upload, and what to do with the staging afterwards.
//
// The staging directory holds the only copy of an upload the server has already
// answered 200 for. The client is gone, it believes the package is published,
// and it will not send those bytes again. So the directory is not scratch space:
// between the last file arriving and the commit landing on GitHub, it is the
// package.
//
// It used to be deleted unconditionally, immediately after a push whose errors
// were swallowed. utxoz/0.8.1 and utxoz/0.9.0 were uploaded, answered 200 file
// by file, and never appeared on the remote; for 0.9.0 the staging directory was
// removed 6 seconds after the last file arrived — the TTL, then a push that
// failed too quickly to have transferred 25MB, then the delete. Nothing was left
// to retry from and nothing was left to look at. See utxo-z#92.
//
// Here the deletion is earned. It happens when the commit is on GitHub and the
// local clone has it, and at no other time. Every other path keeps the bytes.

export const PUBLISHED = 'published';
export const KEPT = 'kept';

/**
 * Publish one staged upload.
 *
 * Dependencies are injected rather than imported so this can be tested without
 * a network, a git repository or a filesystem — the failures worth testing here
 * are GitHub refusing a token and a pull that does not arrive, neither of which
 * can be arranged against the real thing on demand.
 *
 * @param {object} deps
 *   uploadToRepo(token, uploadPath, owner, repo, branch, message) -> Promise
 *   performGithubPull() -> Promise
 *   removeStaging(tmpDir) -> void
 *   log      { info(msg), error(msg) }
 * @param {object} entry  the cache entry: token, owner, repo, branch,
 *                        recipe_name, version, revision, tmpDir, uploadPath,
 *                        commitMessage
 * @returns {Promise<{outcome: string, stage: string, reason?: string}>}
 */
export async function publishStaging(deps, entry) {
    const { uploadToRepo, performGithubPull, removeStaging, log } = deps;
    const { token, owner, repo, branch, uploadPath, commitMessage, tmpDir } = entry;

    const what = describe(entry);

    try {
        await uploadToRepo(token, uploadPath, owner, repo, branch, commitMessage);
    } catch (err) {
        // The push is where an invalid or expired credential is finally
        // noticed: the server accepts any string at login and only GitHub says
        // otherwise, here, long after the client was told the upload worked.
        // Keeping the staging is what makes that recoverable rather than a
        // package that silently ceased to exist.
        return keep(log, what, tmpDir, 'the push to GitHub failed', err, token);
    }

    try {
        await performGithubPull();
    } catch (err) {
        // The commit is on GitHub but the local clone does not have it, and the
        // local clone is what every read is served from. The package exists and
        // is invisible, which is not a state to delete the evidence of.
        return keep(log, what, tmpDir, 'the commit was pushed but the local clone could not be updated', err, token);
    }

    // Awaited, and its failure is its own outcome.
    //
    // Removal is filesystem work that can fail — a permission, a busy mount, a
    // full inode table — and the callback form of fs.rm returned before it had
    // happened. Calling it and announcing success in the next line reported the
    // staging as gone whether or not it was, which is the same kind of claim
    // this whole change exists to stop making.
    try {
        await removeStaging(tmpDir);
    } catch (err) {
        // The package is published: the push landed and the clone has it. Only
        // the tidying failed, so this is not a lost upload — it is a directory
        // left behind, and saying so is what stops it being mistaken for one of
        // the failures above.
        log.error(`[publish] ${what} published, but its staging could not be removed`);
        log.error(`[publish] ${redact(err, token)}`);
        log.error(`[publish] staging left at ${tmpDir} — the package is published; this directory is only leftover`);
        return { outcome: PUBLISHED, stage: 'kept', reason: 'the staging could not be removed' };
    }

    log.info(`[publish] ${what} published; staging removed`);
    return { outcome: PUBLISHED, stage: 'removed' };
}

function keep(log, what, tmpDir, reason, err, token) {
    log.error(`[publish] ${what} NOT published: ${reason}`);
    log.error(`[publish] ${redact(err, token)}`);
    log.error(`[publish] staging kept at ${tmpDir} — the upload is still on disk and nothing has been lost`);
    return { outcome: KEPT, stage: 'kept', reason };
}

function describe(entry) {
    const { recipe_name, version, revision } = entry;
    return `${recipe_name}/${version}#${revision}`;
}

/**
 * An error as a single line, with the credential removed.
 *
 * The token is a GitHub PAT supplied by the client, and Octokit puts the failing
 * request in its error message. A log that quotes it verbatim turns every push
 * failure into a credential leak — into a file, a terminal, or a paste in a bug
 * report.
 *
 * The exact value is what gets removed, because the exact value is what we have.
 * Pattern matching alone cannot do this job: legacy PATs are forty hex
 * characters and so are git commit SHAs, so a rule broad enough to catch the
 * first would strip the second out of every message it appears in — and the SHA
 * is often the most useful thing in the line. The patterns stay as a backstop
 * for a token that is not this request's, never as the primary defence.
 *
 * Stacks are not logged: the message and the reference identify the failure,
 * and the stack only adds paths.
 */
export function redact(err, secret) {
    let text = err && err.message ? err.message : String(err);

    if (typeof secret === 'string' && secret.length >= 8) {
        text = text.split(secret).join('[redacted-token]');
    }

    return text
        .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, '[redacted-token]')
        .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[redacted-token]')
        .replace(/(authorization|bearer)(["'\s:=]+)\S+/gi, '$1$2[redacted]');
}
