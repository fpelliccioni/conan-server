// Keeping the credential out of the log.
//
// Its own module because two unrelated places need it and neither should have
// to import the other: the publish path, which logs why a push failed, and the
// request error handler, which logs whatever was thrown out of a request.
//
// Both are logging things that look safe and are not. Octokit builds its error
// messages from the request that failed, headers included, and `err.stack` reads
// as though it could only contain frames. The credential here is a GitHub PAT
// with write access to the package repository, and a log is a file, a terminal,
// and eventually a paste into a bug report.

/**
 * `value` as a single string, with `secret` removed from it.
 *
 * The exact value is what gets removed, because the exact value is what we have.
 * Pattern matching alone cannot do this job: a legacy PAT is forty hex
 * characters and so is a git commit SHA, so a rule broad enough to catch the
 * first strips the second out of every message it appears in — and the SHA is
 * usually the most useful thing in the line. The shape patterns stay as a
 * backstop for a credential that is not the one this request carried, never as
 * the primary defence.
 *
 * Redaction must not destroy the diagnosis: what is removed is the credential,
 * not the sentence around it.
 *
 * @param {unknown} value   a string, an Error, or anything stringifiable
 * @param {string=} secret  the credential to remove, when one is known
 */
export function redactSecret(value, secret) {
    let out = typeof value === 'string' ? value : String(value);

    // A short secret would match everywhere and turn the message into redaction
    // markers. A credential is never short, so refusing to substring-replace on
    // something tiny costs nothing and saves the log line.
    if (typeof secret === 'string' && secret.length >= 8) {
        out = out.split(secret).join('[redacted-token]');
    }

    return out
        .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, '[redacted-token]')
        .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[redacted-token]')
        .replace(/(authorization|bearer)(["'\s:=]+)\S+/gi, '$1$2[redacted]');
}

/**
 * The message of an error, or the error as a string. The stack is deliberately
 * not included: the message and the reference identify the failure, and the
 * stack only adds paths.
 */
export function messageOf(err) {
    return err && err.message ? err.message : String(err);
}
