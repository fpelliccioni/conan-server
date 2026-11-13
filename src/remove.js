import path from 'node:path';
import { lstat, readdir, readFile } from 'node:fs/promises';

function failure(message, status) {
    return Object.assign(new Error(message), { status });
}

function segment(value) {
    if (typeof value !== 'string' || value.length > 128 ||
        !/^[a-zA-Z0-9_][a-zA-Z0-9_.+-]*$/.test(value))
        throw failure('Invalid package reference', 400);
    return value;
}

// No caller-supplied path can select a recipe or export_sources archive.
export function binaryPath(target) {
    const parts = [segment(target.recipe_name), segment(target.version),
        segment(target.revision), 'packages'];
    if (target.package_id) parts.push(segment(target.package_id));
    if (target.package_revision) {
        if (!target.package_id) throw failure('Missing package ID', 400);
        parts.push(segment(target.package_revision));
    }
    return parts.join('/');
}

export async function existingDirectory(root, relative) {
    let current = path.resolve(root);
    for (const part of relative.split('/')) {
        current = path.join(current, part);
        let entry;
        try { entry = await lstat(current); }
        catch (error) {
            if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
                throw failure('Package not found', 404);
            throw error;
        }
        if (entry.isSymbolicLink() || !entry.isDirectory())
            throw failure('Invalid package directory', 400);
    }
    return current;
}

export async function readMetadata(file) {
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink())
        throw failure('Invalid package metadata', 400);
    return readFile(file, 'utf8');
}

export async function packageRevisions(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    let latest;
    try { latest = JSON.parse(await readMetadata(path.join(directory, 'latest.json'))); } catch (error) { if (error.status) throw error; }
    const revisions = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try { segment(entry.name); } catch { continue; }
        let milliseconds = 0;
        try {
            const manifest = await readMetadata(path.join(directory, entry.name, 'conanmanifest.txt'));
            const timestamp = Number(manifest.split('\n', 1)[0]) * 1000;
            if (Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime()))
                milliseconds = timestamp;
        } catch (error) { if (error.status) throw error; }
        const time = latest?.revision === entry.name && !Number.isNaN(Date.parse(latest.time))
            ? latest.time : new Date(milliseconds).toISOString();
        revisions.push({ revision: entry.name, time });
    }
    return revisions.sort((a, b) => Date.parse(b.time) - Date.parse(a.time) || a.revision.localeCompare(b.revision));
}

export function registerBinaryRoutes(app, deps) {
    const base = '/api/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages';
    app.get(`${base}/:package_id/revisions`, async (req, res, next) => {
        try {
            const relative = binaryPath(req.params);
            const directory = await existingDirectory(deps.root(), relative);
            deps.headers(res);
            res.json({ revisions: await packageRevisions(directory) });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message });
            next(error);
        }
    });
    const remove = async (req, res, next) => {
        try {
            const token = await deps.authorize(req, res);
            if (!token) return;
            binaryPath(req.params);
            await deps.run(async () => {
                await deps.remove(token, req.params);
                // A successful response means the read clone reflects the pushed deletion.
                await deps.refresh();
            });
            deps.headers(res);
            res.status(200).send();
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message });
            next(error);
        }
    };
    app.delete(base, remove);
    app.delete(`${base}/:package_id/revisions/:package_revision`, remove);
}
