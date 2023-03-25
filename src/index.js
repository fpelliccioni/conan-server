import express from 'express';
import morgan from 'morgan';
import fs from 'fs';
import Octokit from '@octokit/rest';
import path from 'path';
import {encode, decode, labels} from 'windows-1252';
import getRawBody from 'raw-body';
import typeis from 'type-is';
import { uploadToRepo } from './github.js';
import crypto from 'crypto';
import NodeCache from 'node-cache';

const app = express();
const expirationTime = 5; // seconds

// -----------------------------------------------------------------------------

function getAuth(authHeader) {
    if (!authHeader) return undefined;

    const authType = authHeader.split(' ')[0];
    const credentials = authHeader.split(' ')[1];

    if (authType === 'Basic') {
        return getBasicAuth(credentials);
    } else if (authType === 'Bearer') {
        return getBearerAuth(credentials);
    }
    console.log('Not supported auth type: ' + authType);
    return { username: undefined, password: undefined, token: undefined };
}

function getBasicAuth(credentials) {
    const decoded = Buffer.from(credentials, 'base64').toString();
    const [username, password] = decoded.split(':');
    return { username, password };
}

function getBearerAuth(credentials) {
    return { token: credentials };
}

function writeCommonHeaders(res) {
    res.set('X-JFrog-Version', 'Artifactory/7.55.6 75506900');
    res.set('X-Artifactory-Id', '78cd56d518ee33a1:301d323a:18704509130:-8000');
    res.set('X-Artifactory-Node-Id', 'aca04be74fe9');
    res.set('X-Conan-Server-Version', '0.20.0');
    res.set('X-Conan-Server-Capabilities', 'complex_search,checksum_deploy,revisions,matrix_params');
}

function createTempDir() {
    const __dirname = path.resolve(path.dirname(''));
    const tmpDirBase = path.resolve(path.join(__dirname, 'tmp/'));

    if (!fs.existsSync(tmpDirBase)) {
      fs.mkdirSync(tmpDirBase);
    }

    let tmpDir;
    const appPrefix = 'upload-';
    try {
        tmpDir = fs.mkdtempSync(path.join(tmpDirBase, appPrefix));

        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir);
          }

        return tmpDir;
    }
    catch {
      // handle error
    }
    finally {
      try {
        if (tmpDir) {
          fs.rmSync(tmpDir, { recursive: true });
        }
      }
      catch (e) {
        console.error(`An error has occurred while removing the temp folder at ${tmpDir}. Please remove it manually. Error: ${e}`);
      }
    }
    return undefined;
}

function getContentTypeForFile(file_name) {
    if (file_name.endsWith('.txt')) {
        return 'text/plain';
    }

    if (file_name.endsWith('.tgz')) {
        return 'application/x-gzip';
    }

    if (file_name.endsWith('.py')) {
        return 'text/x-python';
    }
}

function setContentTypeForFile(res, file_name) {
    res.set('Content-Type', getContentTypeForFile(file_name));
}

// -----------------------------------------------------------------------------

app.set('port', process.env.PORT || 8081);
app.set('json spaces', 2)

const appendContentType = (req, res, next) => {
    if (!req.headers['content-type']) {
        req.headers['content-type'] = 'application/octet-stream';
    }
    next();
};
app.use(appendContentType);
app.use(morgan('dev'));
app.use(express.raw({limit: '50mb'}));
app.use(express.urlencoded({extended:false}));
app.use(express.json());
app.use(express.text());


// Authentication ---------------------------------------------------------------

app.get('/api/v1/ping', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('X-Client-Id');
    const auth = req.header('Authorization');
    const { owner, repo, branch } = { owner: process.env.OWNER, repo: process.env.REPO, branch: process.env.BRANCH}

    writeCommonHeaders(res);
    res.status(200).send();
});

app.get('/api/v2/users/authenticate', (req, res) => {
    const auth = req.header('Authorization');
    const { username, password } = getAuth(auth);
    const requestBody = req.body;
    writeCommonHeaders(res);
    res.status(200).send(password);
});

app.get('/api/v2/users/check_credentials', (req, res) => {
    const auth = req.header('Authorization');
    const { username, password } = getAuth(auth);
    writeCommonHeaders(res);
    res.status(200).send();
});

// Get Recipe Informaton --------------------------------------------------------

async function getGithubFileContent(owner, repo, branch, path, token = undefined) {
    const octo = token ? new Octokit({ auth: token }) : new Octokit()
    try {
        const content = await octo.repos.getContents({ owner, repo, path, ref: branch })
        const download_url = content.data.download_url;
        const response = await fetch(download_url);

        if (path.endsWith('.tgz')) {
            const buffer = await response.arrayBuffer();
            const view = new Uint8Array(buffer);
            return view;
        }

        const text = await response.text();
        return text;
    } catch (error) {
        console.error(`Error: ${error}`);
        return undefined;
    }
}

async function getGithubDirContent(owner, repo, branch, path, token = undefined) {
    const octo = token ? new Octokit({ auth: token }) : new Octokit()
    try {
        const content = await octo.repos.getContents({ owner, repo, path, ref: branch })
        let files = {};
        for (const file of content.data) {
            if (file.type === 'file') {
                files[file.name] = {};
            }
        }
        return files;
    } catch (error) {
        return undefined;
    }
}

app.get('/api/v2/conans/:recipe_name/:version/_/_/latest', async (req, res) => {
    const { recipe_name, version } = req.params;
    const { owner, repo, branch } = { owner: process.env.OWNER, repo: process.env.REPO, branch: process.env.BRANCH}
    const path = `${recipe_name}/${version}/latest.json`;
    console.log(`path: ${path}`)

    const auth = req.header('Authorization');
    const { token } = getAuth(auth);

    const latest = await getGithubFileContent(owner, repo, branch, path, token)
    if ( ! latest) {
        res.status(404).send();
        return;
    }
    writeCommonHeaders(res);
    res.set('Content-Type', 'application/json');
    res.status(200).send(latest);
});

app.get('/api/v2/conans/:recipe_name/:version/_/_/revisions/:revision/files', async (req, res) => {
    const { recipe_name, version, revision } = req.params;
    const { owner, repo, branch } = { owner: process.env.OWNER, repo: process.env.REPO, branch: process.env.BRANCH}
    const path = `${recipe_name}/${version}/${revision}/`;

    const auth = req.header('Authorization');
    const { token } = getAuth(auth);

    const files = await getGithubDirContent(owner, repo, branch, path, token);
    if ( ! files) {
        res.status(404).send();
        return;
    }

    const json = {
        "files": files
    };


    writeCommonHeaders(res);
    res.set('Content-Type', 'application/json');
    res.status(200).send(json);
});

app.get('/api/v2/conans/:recipe_name/:version/_/_/revisions/:revision/files/:file_name', async (req, res) => {
    const { recipe_name, version, revision, file_name } = req.params;
    const { owner, repo, branch } = { owner: process.env.OWNER, repo: process.env.REPO, branch: process.env.BRANCH}
    const path = `${recipe_name}/${version}/${revision}/${file_name}`;

    const auth = req.header('Authorization');
    const { token } = getAuth(auth);

    const latest = await getGithubFileContent(owner, repo, branch, path, token)
    if ( ! latest) {
        res.status(404).send();
        return;
    }

    writeCommonHeaders(res);
    setContentTypeForFile(res, file_name);

    if (file_name.endsWith('.tgz')) {
        res.writeHead(200, {
            // 'Content-Type': mimetype,
            'Content-disposition': 'attachment;filename=' + file_name,
            'Content-Length': latest.length
        });
        res.end(Buffer.from(latest, 'binary'));

        return;
    }

    res.status(200).send(latest);
});

app.get('/api/v2/conans/:recipe_name/:version/_/_/revisions', async (req, res) => {
    const { recipe_name, version } = req.params;
    const { owner, repo, branch } = { owner: process.env.OWNER, repo: process.env.REPO, branch: process.env.BRANCH}
    const path = `${recipe_name}/${version}/latest.json`;
    const auth = req.header('Authorization');
    const { token } = getAuth(auth);

    const latest = await getGithubFileContent(owner, repo, branch, path, token)
    if ( ! latest) {
        res.status(404).send();
        return;
    }

    writeCommonHeaders(res);

    const latestObj = JSON.parse(latest);

    const json = {
        "reference": `${recipe_name}/${version}@_/_`,
        "revisions": [
            latestObj
        ]
    }

    res.set('Content-Type', 'application/json');
    res.status(200).send(json);
});

app.get('/api/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/latest', async (req, res) => {
    const { recipe_name, version, revision, package_id } = req.params;
    const { owner, repo, branch } = { owner: process.env.OWNER, repo: process.env.REPO, branch: process.env.BRANCH}
    const path = `${recipe_name}/${version}/${revision}/packages/${package_id}/latest.json`;
    const auth = req.header('Authorization');
    const { token } = getAuth(auth);

    const latest = await getGithubFileContent(owner, repo, branch, path, token)
    if ( ! latest) {
        res.status(404).send();
        return;
    }

    writeCommonHeaders(res);
    res.set('Content-Type', 'application/json');
    res.status(200).send(latest);

});

app.get('/api/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/revisions/:package_revision/files', async (req, res) => {
    const { recipe_name, version, revision, package_id, package_revision } = req.params;
    const { owner, repo, branch } = { owner: process.env.OWNER, repo: process.env.REPO, branch: process.env.BRANCH}
    const path = `${recipe_name}/${version}/${revision}/packages/${package_id}/${package_revision}/`;
    const auth = req.header('Authorization');
    const { token } = getAuth(auth);

    const files = await getGithubDirContent(owner, repo, branch, path, token);
    if ( ! files) {
        res.status(404).send();
        return;
    }

    const json = {
        "files": files
    };

    writeCommonHeaders(res);

    res.set('Content-Type', 'application/json');
    res.status(200).send(json);
});

app.get('/api/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/revisions/:package_revision/files/:file_name', async (req, res) => {
    const { recipe_name, version, revision, package_id, package_revision, file_name } = req.params;
    const { owner, repo, branch } = { owner: process.env.OWNER, repo: process.env.REPO, branch: process.env.BRANCH}
    const path = `${recipe_name}/${version}/${revision}/packages/${package_id}/${package_revision}/${file_name}`;
    const auth = req.header('Authorization');
    const { token } = getAuth(auth);

    const latest = await getGithubFileContent(owner, repo, branch, path, token)
    if ( ! latest) {
        res.status(404).send();
        return;
    }

    writeCommonHeaders(res);
    setContentTypeForFile(res, file_name);

    if (file_name.endsWith('.tgz')) {
        res.writeHead(200, {
            // 'Content-Type': mimetype,
            'Content-disposition': 'attachment;filename=' + file_name,
            'Content-Length': latest.length
        });
        res.end(Buffer.from(latest, 'binary'));

        return;
    }

    res.status(200).send(latest);
});

// PUT endpoints ---------------------------------------------------------------

function getLatestInJson(revision) {
    const now = new Date();
    const utcDate = now.toISOString().replace('Z', '+0000');
    const data = {
        "revision": revision,
        "time": utcDate
    };
    const jsonStr = JSON.stringify(data, null, 2);
    return jsonStr;
}

function getUploadPath(tmpDir, owner, repo, branch) {
    const uploadPath = `${tmpDir}/${owner}/${repo}/${branch}`;
    return uploadPath;
}

function createPaths(tmpDir, owner, repo, branch, recipe_name, version) {
    const uploadPath = getUploadPath(tmpDir, owner, repo, branch);
    const versionPath = `${uploadPath}/${recipe_name}/${version}`;

    if (!fs.existsSync(versionPath)) {
        fs.mkdirSync(versionPath, { recursive: true });
    }

    return versionPath;
}

function getCommitMessage(recipe_name, version, revision) {
    const commitMessage = `Upload ${recipe_name}/${version} revision ${revision}.`;
    return commitMessage;
}

function cleanUpTmpDir(tmpDir) {
    fs.rm(tmpDir, { recursive: true, force: true }, (err) => {
        if (err) {
            console.log(err);
        }
    });
}

function verifyFileContent(fileContent, checkSumSha1) {
    const hash = crypto.createHash('sha1');
    hash.update(fileContent);
    const sha1 = hash.digest('hex');
    if (sha1 !== checkSumSha1) {
        console.error(`Checksum mismatch. Expected: ${checkSumSha1}, got: ${sha1}`);
        return false;
    }
    return true;
}

async function nonThrowingUploadToRepo(token, uploadPath, owner, repo, branch, commitMessage) {
    try {
        await uploadToRepo(token, uploadPath, owner, repo, branch, commitMessage)
    } catch (err) {
        console.error(`Error uploading to repo: ${err}`);
    }
}

function justWriteFile(res, fileContent, filePath) {
    fs.writeFile(filePath, fileContent, async (err) => {
        if (err) {
            console.error(`Error writing file: ${err}`);
            res.status(500).send();
        } else {
            res.status(200).send();
        }
    });
}

async function writeRecipeLatestJson(tmpDir, owner, repo, branch, recipe_name, version, revision) {
    const versionPath = createPaths(tmpDir, owner, repo, branch, recipe_name, version)

    const latestJsonPath = `${versionPath}/latest.json`;
    const latestJson = getLatestInJson(revision);
    fs.writeFile(latestJsonPath, latestJson, 'utf8', async (err) => {
        if (err) {
            console.log(err);
            return;
        }
    });
}

async function writePackageLatestJson(tmpDir, owner, repo, branch, recipe_name, version, revision, package_id, package_revision) {
    const versionPath = createPaths(tmpDir, owner, repo, branch, recipe_name, version)

    const latestJsonDir = `${versionPath}/${revision}/packages/${package_id}/`;
    const latestJsonPath = `${latestJsonDir}/latest.json`;
    const latestJson = getLatestInJson(package_revision);

    if (!fs.existsSync(latestJsonDir)) {
        fs.mkdirSync(latestJsonDir, { recursive: true });
    }

    fs.writeFile(latestJsonPath, latestJson, 'utf8', async (err) => {
        if (err) {
            console.log(err);
            return;
        }
    });
}

function getOrSetCacheEntry(owner, repo, branch, recipe_name, version, revision, token) {
    const key = `${owner}/${repo}/${branch}/${recipe_name}/${version}`;

    let value = myCache.get(key);
    if (value) {
        myCache.ttl(key, expirationTime)
        return { key, value };
    }

    value = {
        token: token,
        owner: owner,
        repo: repo,
        branch: branch,
        recipe_name: recipe_name,
        version: version,
        revision: revision,
        tmpDir: createTempDir(),
    };
    const success = myCache.set( key, value );
    if ( ! success ) {
        console.error(`Error setting cache entry`);
        return undefined;
    }
    return { key, value };
}

app.put('/api/v2/conans/:recipe_name/:version/_/_/revisions/:revision/files/:file_name', express.raw({type: '*/*'}), async (req, res) => {
    const auth = req.header('Authorization');
    const checksumDeploy = req.header('X-Checksum-Deploy');
    const checksumSha1 = req.header('X-Checksum-Sha1');

    if (checksumDeploy === 'true') {
        const json = {
            "errors": [
                {
                    "status": 404,
                    "message": `Checksum deploy failed. No existing file with SHA1: ${checksumSha1}`
                }
            ]
        };
        res.status(404).json(json);
        return;
    }

    const { recipe_name, version, revision, file_name } = req.params;
    const { owner, repo, branch } = { owner: process.env.OWNER, repo: process.env.REPO, branch: process.env.BRANCH}
    const { token } = getAuth(auth);
    const { key, value } = getOrSetCacheEntry(owner, repo, branch, recipe_name, version, revision, token);
    const fileContent = req.body;

    if  ( ! verifyFileContent(fileContent, checksumSha1)) {
        res.status(500).send();
        return;
    }

    if (file_name === 'conanfile.py' || file_name === 'conanfile.txt') {
        await writeRecipeLatestJson(value.tmpDir, owner, repo, branch, recipe_name, version, revision);
    }

    const versionPath = createPaths(value.tmpDir, owner, repo, branch, recipe_name, version)
    const dirPath = `${versionPath}/${revision}`;
    const filePath = `${dirPath}/${file_name}`;

    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    justWriteFile(res, fileContent, filePath);
});

app.put('/api/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/revisions/:package_revision/files/:file_name', express.raw({type: '*/*'}), async (req, res) => {
    const auth = req.header('Authorization');
    const checksumDeploy = req.header('X-Checksum-Deploy');
    const checksumSha1 = req.header('X-Checksum-Sha1');

    if (checksumDeploy === 'true') {
        const json = {
            "errors": [
                {
                    "status": 404,
                    "message": `Checksum deploy failed. No existing file with SHA1: ${checksumSha1}`
                }
            ]
        };
        res.status(404).json(json);
        return;
    }

    const { recipe_name, version, revision, package_id, package_revision, file_name } = req.params;
    const { owner, repo, branch } = { owner: process.env.OWNER, repo: process.env.REPO, branch: process.env.BRANCH}
    const { token } = getAuth(auth);
    const { key, value } = getOrSetCacheEntry(owner, repo, branch, recipe_name, version, revision, token);

    const fileContent = req.body;
    if  ( ! verifyFileContent(fileContent, checksumSha1)) {
        res.status(500).send();
        return;
    }

    if (file_name === 'conanmanifest.txt') {
        await writePackageLatestJson(value.tmpDir, owner, repo, branch, recipe_name, version, revision, package_id, package_revision);
    }

    const versionPath = createPaths(value.tmpDir, owner, repo, branch, recipe_name, version)
    const dirPath = `${versionPath}/${revision}/packages/${package_id}/${package_revision}`;
    const filePath = `${dirPath}/${file_name}`;

    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    justWriteFile(res, fileContent, filePath);
});

// ----------------------------------------------------------------------------------------------------------------------------

app.listen(app.get('port'),()=>{
    console.log(`Server listening on port ${app.get('port')}`);
});

const myCache = new NodeCache( { stdTTL: expirationTime, checkperiod: 2 } )

myCache.on("expired", async function(key, value){
    console.log(`${key} Cache Expired, uploading to repo...`);

    const { token, owner, repo, branch, recipe_name, version, tmpDir, revision } = value;

    console.log(`owner: ${owner}`);
    console.log(`repo: ${repo}`);
    console.log(`branch: ${branch}`);
    console.log(`recipe_name: ${recipe_name}`);
    console.log(`version: ${version}`);
    console.log(`revision: ${revision}`);
    console.log(`tmpDir: ${tmpDir}`);

    const uploadPath = getUploadPath(tmpDir, owner, repo, branch);

    const commitMessage = getCommitMessage(recipe_name, version, revision);
    await nonThrowingUploadToRepo(token, uploadPath, owner, repo, branch, commitMessage);

    cleanUpTmpDir(tmpDir);
});

