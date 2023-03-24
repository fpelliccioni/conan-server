import express from 'express';
import morgan from 'morgan';
import fs from 'fs';
import Octokit from '@octokit/rest';
import path from 'path';
import {encode, decode, labels} from 'windows-1252';
import getRawBody from 'raw-body';
import typeis from 'type-is';
import { uploadToRepo } from './routes/github.js';
import crypto from 'crypto';
// const NodeCache = require( "node-cache" );
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
    return undefined;
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
    // Set these headers:
    // X-JFrog-Version: Artifactory/7.55.6 75506900
    // X-Artifactory-Id: 78cd56d518ee33a1:301d323a:18704509130:-8000
    // X-Artifactory-Node-Id: aca04be74fe9
    // X-Conan-Server-Version: 0.20.0
    // X-Conan-Server-Capabilities: complex_search,checksum_deploy,revisions,matrix_params
    // Content-Length: 0
    // Date: Tue, 21 Mar 2023 13:25:17 GMT
    // Keep-Alive: timeout=60
    // Connection: keep-alive

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
    // console.log(`appendContentType:  req.headers['content-type']: ${    req.headers['content-type']}`)
    if (!req.headers['content-type']) {
        req.headers['content-type'] = 'application/octet-stream';
    }
    // console.log(`appendContentType:  req.headers['content-type']: ${    req.headers['content-type']}`)
    next();
};
app.use(appendContentType);
app.use(morgan('dev'));
app.use(express.raw());
app.use(express.urlencoded({extended:false}));
app.use(express.json());
app.use(express.text());




// const router = Router();

// Authentication ---------------------------------------------------------------

app.get('/api/:owner/:repo/:branch/v1/ping', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('X-Client-Id');
    const auth = req.header('Authorization');

    const { owner, repo, branch } = req.params;

    // console.log(`Received request with headers:
    //   X-Client-Anonymous-Id: ${anonymousId}
    //   X-Client-Id: ${clientId}
    //   Authorization: ${auth}
    // `);
    // console.log(`Parameters:
    //     owner: ${owner}
    //     repo: ${repo}
    //     branch: ${branch}
    // `);

    writeCommonHeaders(res);
    res.status(200).send();
});

app.get('/api/:owner/:repo/:branch/v2/users/authenticate', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('X-Client-Id');
    const auth = req.header('Authorization');

    const { username, password } = getAuth(auth);

    // // Log headers
    // console.log(`Received request with headers:
    //   X-Client-Anonymous-Id: ${anonymousId}
    //   X-Client-Id: ${clientId}
    //   Authorization: ${auth}
    //   username: ${username}
    //   password: ${password}
    // `);

    const requestBody = req.body;
    // console.log(`Received request body: ${requestBody}`);
    writeCommonHeaders(res);
    res.status(200).send(password);
});

app.get('/api/:owner/:repo/:branch/v2/users/check_credentials', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('x-client-id');
    const auth = req.header('Authorization');

    // console.log(`Received request with headers:
    //   x-Client-Anonymous-Id: ${anonymousId}
    //   X-Client-Id: ${clientId}
    //   Authorization: ${auth}
    // `);

    const { username, password } = getAuth(auth);

    // Log headers
    // console.log(`Received request with headers:
    //   X-Client-Anonymous-Id: ${anonymousId}
    //   X-Client-Id: ${clientId}
    //   Authorization: ${auth}
    //   username: ${username}
    //   password: ${password}
    // `);

    // console.log(`Received request body: ${JSON.stringify(req.body)}`);
    // console.log(`Received request headers: ${JSON.stringify(req.headers)}`);
    // console.log(`Received request params: ${JSON.stringify(req.params)}`);

    writeCommonHeaders(res);

    // res.status(404).send();
    res.status(200).send();
});

// Get Recipe Informaton --------------------------------------------------------

async function getGithubFileContent(owner, repo, branch, path, token = undefined) {
    const octo = token ? new Octokit({ auth: token }) : new Octokit()
    try {
        const content = await octo.repos.getContents({ owner, repo, path, ref: branch })
        // console.log(`content: ${JSON.stringify(content)}`)
        // console.log(`content.data.download_url: ${content.data.download_url}`)
        const download_url = content.data.download_url;
        const response = await fetch(download_url);

        if (path.endsWith('.tgz')) {
            // const buffer = await response.buffer();
            const buffer = await response.arrayBuffer();
            const view = new Uint8Array(buffer);
            // const buffer = await response.buffer;

            // console.log(`buffer: ${buffer.toString('hex')}`)
            // console.log(`buffer: ${view}`)
            // console.log(`buffer: ${view.toString('hex')}`)
            return view;
        }

        const text = await response.text();
        // console.log(`text: ${text}`)
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
        // console.log(`content: ${JSON.stringify(content)}`)
        let files = {};
        for (const file of content.data) {
            if (file.type === 'file') {
                files[file.name] = {};
            }
        }
        return files;
    } catch (error) {
        // console.error(`Error: ${error}`);
        return undefined;
    }
}


app.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/latest', async (req, res) => {
    const { owner, repo, branch, recipe_name, version } = req.params;
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

app.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/files', async (req, res) => {
    const { owner, repo, branch, recipe_name, version, revision } = req.params;
    const path = `${recipe_name}/${version}/${revision}/`;
    // console.log(`path: ${path}`)

    const auth = req.header('Authorization');
    const { token } = getAuth(auth);

    const files = await getGithubDirContent(owner, repo, branch, path, token);
    if ( ! files) {
        res.status(404).send();
        // res.status(404).send('Not found');
        return;
    }

    const json = {
        "files": files
    };

    // console.log(`json: ${JSON.stringify(json)}`)

    writeCommonHeaders(res);

    res.set('Content-Type', 'application/json');
    res.status(200).send(json);
});

app.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/files/:file_name', async (req, res) => {
    const { owner, repo, branch, recipe_name, version, revision, file_name } = req.params;
    const path = `${recipe_name}/${version}/${revision}/${file_name}`;
    // console.log(`path: ${path}`)

    const auth = req.header('Authorization');
    const { token } = getAuth(auth);

    const latest = await getGithubFileContent(owner, repo, branch, path, token)
    if ( ! latest) {
        res.status(404).send();
        return;
    }

    // console.log(`latest: ${latest}`);
    // console.log(`latest.length: ${latest.length}`);

    // conanmanifest.txt

    writeCommonHeaders(res);
    // res.set('Transfer-Encoding', 'chunked');
    // res.set('Content-Type', 'application/json');

    // if file_name extension is .txt, set Content-Type to text/plain
    // if file_name extension is .zip, set Content-Type to application/zip
    // if file_name extension is .tgz, set Content-Type to application/gzip
    // if file_name extension is .py, set Content-Type to text/x-python

    // if (file_name.endsWith('.txt')) {
    //     res.set('Content-Type', 'text/plain');
    // } else if (file_name.endsWith('.tgz')) {
    //     res.set('Content-Type', 'application/x-gzip');
    // } else if (file_name.endsWith('.py')) {
    //     res.set('Content-Type', 'text/x-python');
    // }
    setContentTypeForFile(res, file_name);

    res.status(200).send(latest);

    // response body in chunked encoding
    // res.write(latest);
    // res.end();
    // res.status(200);
});

app.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions', async (req, res) => {
    const { owner, repo, branch, recipe_name, version } = req.params;

    const path = `${recipe_name}/${version}/latest.json`;
    // console.log(`path: ${path}`)

    const auth = req.header('Authorization');
    const { token } = getAuth(auth);

    const latest = await getGithubFileContent(owner, repo, branch, path, token)
    if ( ! latest) {
        res.status(404).send();
        return;
    }

    // console.log(`latest: ${latest}`);
    // console.log(`latest.length: ${latest.length}`);

    writeCommonHeaders(res);
    // res.set('Transfer-Encoding', 'chunked');

    // latest is a string containing a json, convert it to json
    const latestObj = JSON.parse(latest);
    // console.log(`latestObj: ${JSON.stringify(latestObj)}`)

    const json = {
        "reference": `${recipe_name}/${version}@_/_`,
        "revisions": [
            latestObj
        ]
    }
    // console.log(`json: ${JSON.stringify(json)}`)

    res.set('Content-Type', 'application/json');
    res.status(200).send(json);
});

app.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/latest', async (req, res) => {
    const { owner, repo, branch, recipe_name, version, revision, package_id } = req.params;

    const path = `${recipe_name}/${version}/${revision}/packages/${package_id}/latest.json`;
    // console.log(`path: ${path}`)

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

app.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/revisions/:package_revision/files', async (req, res) => {
    const { owner, repo, branch, recipe_name, version, revision, package_id, package_revision } = req.params;

    // const path = `${recipe_name}/${version}/${revision}/`;
    const path = `${recipe_name}/${version}/${revision}/packages/${package_id}/${package_revision}/`;
    // console.log(`path: ${path}`)

    const auth = req.header('Authorization');
    const { token } = getAuth(auth);

    const files = await getGithubDirContent(owner, repo, branch, path, token);
    if ( ! files) {
        res.status(404).send();
        // res.status(404).send('Not found');
        return;
    }

    const json = {
        "files": files
    };

    // console.log(`json: ${JSON.stringify(json)}`)
    writeCommonHeaders(res);

    res.set('Content-Type', 'application/json');
    res.status(200).send(json);

    // const octo = new Octokit()
    // try {
    //     const content = await octo.repos.getContents({ owner, repo, path, ref: branch })
    //     // console.log(`content: ${JSON.stringify(content)}`)

    //     let files = {};
    //     for (const file of content.data) {
    //         // console.log(`file: ${JSON.stringify(file)}`)
    //         // console.log(`file.name: ${file.name}`)
    //         if (file.type === 'file') {
    //             files[file.name] = {};
    //         }
    //     }

    //     const json = {
    //         "files": files
    //     };

    //     // console.log(`json: ${JSON.stringify(json)}`)

    //     writeCommonHeaders(res);

    //     res.set('Content-Type', 'application/json');
    //     res.status(200).send(json);
    // } catch (error) {
    //     res.status(404).send('Not found');
    // }
});

app.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/revisions/:package_revision/files/:file_name', async (req, res) => {

    const { owner, repo, branch, recipe_name, version, revision, package_id, package_revision, file_name } = req.params;

    // const path = `${recipe_name}/${version}/${revision}/${file_name}`;
    const path = `${recipe_name}/${version}/${revision}/packages/${package_id}/${package_revision}/${file_name}`;
    // console.log(`path: ${path}`)

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
        // console.log(`latest: ${latest}`);
        // console.log(`latest.length: ${latest.length}`);

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
            // console.log(`File saved as: ${filePath}`);
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
        // console.log(`Cache hit for ${key}`);
        // console.log(`ttl: ${myCache.getTtl(key)}`);
        myCache.ttl(key, expirationTime)
        // console.log(`ttl: ${myCache.getTtl(key)}`);
        return { key, value };
    }
    // console.log(`Cache miss for ${key}`);

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
    // const success = myCache.set( key, value, expirationTime );
    const success = myCache.set( key, value );
    if ( ! success ) {
        console.error(`Error setting cache entry`);
        return undefined;
    }
    return { key, value };
}

app.put('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/files/:file_name', express.raw({type: '*/*'}), async (req, res) => {
    // const anonymousId = req.header('X-Client-Anonymous-Id');
    // const clientId = req.header('X-Client-Id');
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

    const { owner, repo, branch, recipe_name, version, revision, file_name } = req.params;
    const { token } = getAuth(auth);

    const { key, value } = getOrSetCacheEntry(owner, repo, branch, recipe_name, version, revision, token);
    // console.log(`key: ${key}`);
    // console.log(`value: ${JSON.stringify(value)}`);

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
    // writeFileAndUpload(res, token, owner, repo, branch, recipe_name, version, revision, fileContent, filePath, uploadPath, tmpDir);
    justWriteFile(res, fileContent, filePath);
});

app.put('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/revisions/:package_revision/files/:file_name', express.raw({type: '*/*'}), async (req, res) => {
    // const anonymousId = req.header('X-Client-Anonymous-Id');
    // const clientId = req.header('X-Client-Id');
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

    const { owner, repo, branch, recipe_name, version, revision, package_id, package_revision, file_name } = req.params;
    const { token } = getAuth(auth);

    const { key, value } = getOrSetCacheEntry(owner, repo, branch, recipe_name, version, revision, token);
    // console.log(`key: ${key}`);
    // console.log(`value: ${JSON.stringify(value)}`);

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
    // writeFileAndUpload(res, token, owner, repo, branch, recipe_name, version, revision, fileContent, filePath, uploadPath, tmpDir);
    justWriteFile(res, fileContent, filePath);
});

// ----------------------------------------------------------------------------------------------------------------------------

app.listen(app.get('port'),()=>{
    console.log(`Server listening on port ${app.get('port')}`);
});

const myCache = new NodeCache( { stdTTL: expirationTime, checkperiod: 2 } )

myCache.on("expired", async function(key, value){
    // console.log(`*************** EXPIRED ***************`)
    console.log(`${key} Cache Expired, uploading to repo...`);
    // console.log(`value: ${JSON.stringify(value)}`);

    const { token, owner, repo, branch, recipe_name, version, tmpDir, revision } = value;
    // console.log(`token: ${token}`);
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

// setInterval(() => {
//     console.log(`*************** INTERVAL ***************`)
//     console.log(`myCache.getStats(): ${JSON.stringify(myCache.getStats())}`);

//     const mykeys = myCache.keys();
//     console.log(`mykeys: ${JSON.stringify(mykeys)}`);

//     const ttl = myCache.getTtl(mykeys[0]);
//     console.log(`ttl: ${ttl}`);

// }, 1000);





// let uploadTimer = setTimeout(() => {
//     sendDataToGithub()
// }, expirationTime);
// clearTimeout(uploadTimer)

// let tmpDir = createTempDir();
// let globalThings = {
//     tmpDir: undefined,
//     uploadTimer: uploadTimer
// }

// function setNewGlobalThings() {
//     if (globalThings.tmpDir) return;
//     globalThings.tmpDir = "temp";   // to avoid data races

//     globalThings.tmpDir = createTempDir();
//     globalThings.uploadTimer = setTimeout(() => {
//         cleanUpTmpDir(globalThings.tmpDir);
//     }, expirationTime);
// }

// function sendDataToGithub() {
//     clearTimeout(globalThings.uploadTimer);

//     const commitMessage = getCommitMessage(recipe_name, version, revision);
//     await nonThrowingUploadToRepo(token, uploadPath, owner, repo, branch, commitMessage);

//     cleanUpTmpDir(globalThings.tmpDir);
// }


// // ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------




    // req.headers['content-type'] = 'application/octet-stream';
    // const istext = typeis(req, ['text/*'])
    // console.log(`istext: ${istext}`);
    // const isall = typeis(req, ['*/*'])
    // console.log(`isall: ${isall}`);
    // const isunknown = typeis(req, ['unknown'])
    // console.log(`isunknown: ${isunknown}`);
    // const isundefined = typeis(req, [undefined])
    // console.log(`isundefined: ${isundefined}`);
    // return;

// import chardet from 'chardet';
// import { toByteArray, utf8ToAnsi } from 'utf8-to-ansi'
// import { encode, decode } from 'windows-1252';
// import fs from 'fs';
// // import chilkat from '@chilkat/ck-node11-linux64';


// // const originalFilePath = `/Users/fernando/dev/conan-server/src/tmp/k-nuth/conan-packages/master/project1/2.0.0/_/_/9d9c0e529e2865cda9823c2c233f7d36/conan_sources.tgz`
// // const originalFilePath = `/home/fernando/Downloads/conan_sources.tgz`
// const originalFilePath = `/home/fernando/dev/conan-server/tmp/k-nuth/conan-packages/master/project1/2.0.0/_/_/9d9c0e529e2865cda9823c2c233f7d36/conan_sources.tgz`



// const binary = fs.readFileSync(originalFilePath, { encoding: null });
// console.log('binary contains: ', binary.toString('hex'));

// // const encoding = chardet.detect(binary);
// // console.log(`encoding: ${encoding}`);


// // // const newFilePath = '/Users/fernando/dev/conan-server/src/tmp/k-nuth/conan-packages/master/project1/2.0.0/_/_/9d9c0e529e2865cda9823c2c233f7d36/conan_sources_new.tgz';
// // // const newFilePath = '/home/fernando/Downloads/conan_sources_new.tgz';
// // const newFilePath = `/home/fernando/dev/conan-server/tmp/k-nuth/conan-packages/master/project1/2.0.0/_/_/9d9c0e529e2865cda9823c2c233f7d36/conan_sources_new.tgz`


// // const cp1252text = encode(binary);
// // // const cp1252text = encode(binary.toString('ascii'));
// // console.log('cp1252text contains: ', cp1252text.toString());
// // // console.log('cp1252text contains: ', decode(cp1252text));
// // // console.log('cp1252text contains: ', decode(cp1252text).toString('hex'));

// // // fs.writeFile(newFilePath, binary, (err) => {
// // //     if (err) {
// // //         console.error(`Error writing file: ${err}`);
// // //     } else {
// // //         console.log(`File saved as: ${newFilePath}`);
// // //     }
// // // });






// // // var os = require('os');
// // // if (os.platform() == 'win32') {
// // //     if (os.arch() == 'ia32') {
// // //         var chilkat = require('@chilkat/ck-node11-win-ia32');
// // //     } else {
// // //         var chilkat = require('@chilkat/ck-node11-win64');
// // //     }
// // // } else if (os.platform() == 'linux') {
// // //     if (os.arch() == 'arm') {
// // //         var chilkat = require('@chilkat/ck-node11-arm');
// // //     } else if (os.arch() == 'x86') {
// // //         var chilkat = require('@chilkat/ck-node11-linux32');
// // //     } else {
// // //         var chilkat = require('@chilkat/ck-node11-linux64');
// // //     }
// // // } else if (os.platform() == 'darwin') {
// // //     var chilkat = require('@chilkat/ck-node11-macosx');
// // // }


// // // It's really simple:  Just load from one charset, save using another.

// // var sb = new chilkat.StringBuilder();

// // // In this case, my test file has some norwegian chars in the utf-8 encoding
// // var success = sb.LoadFile(originalFilePath,"utf-8");

// // success = sb.WriteFile(newFilePath,"windows-1252",false);

// // // Note:  Windows-1252 is a 1-byte per char encoding, which means it's only capable of representing
// // // those chars in Western European languages.   See https://en.wikipedia.org/wiki/Windows-1252
// // //
// // // utf-8 is an encoding that can handle chars in any language, including Chinese, Korean, Japanese, Arabic, Hebrew, Greek, etc.
// // // If a text file contains chars in these other languages, obviously it cannot be converted to windows-1252 because
// // // there are only 256 chars that can possibly be represented in a 1-byte per char encoding.





// // // const hexString = '1f8b08080000000002ff636f6e616e5f';
// // const hexString = '1fefbfbd08080000000002efbfbd636f6e616e5f';
// // const buffer1 = Buffer.from(hexString, 'hex');

// // const encoding = chardet.detect(buffer1);
// // console.log(`encoding: ${encoding}`);

// // const str = buffer1.toString('utf8');
// // const buffer2 = Buffer.from(str, 'utf8');

// // console.log('original content: ', hexString);
// // console.log('buffer1 contains: ', buffer1.toString('hex'));
// // console.log('str contains:     ', str);
// // console.log('buffer2 contains: ', buffer2.toString('hex'));


// // // // const cp1252text = windows1252.encode(hexString);
// // // const cp1252text = windows1252.encode(buffer2.buffer);
// // // console.log('cp1252text contains: ', cp1252text);
// // // console.log('cp1252text contains: ', windows1252.decode(cp1252text));


// // // const {utf8ToAnsi, toByteArray} = require('utf8-to-ansi');

// // const buffer4 = new Buffer.from(toByteArray(str))
// // // console.log(buffer4.toString('hex'))
// // console.log('buffer4 contains: ', buffer4.toString('hex'));

// // const ansi = utf8ToAnsi(str)
// // const buffer5 = Buffer.from(ansi, 'ascii');
// // console.log('buffer5 contains: ', buffer5.toString('hex'));
// // console.log('buffer5 contains: ', buffer5.toString('ascii'));
// // console.log('buffer5 contains: ', buffer5.toString());
// // console.log('buffer5 contains: ', buffer5.toString('utf-8'));

// // const cp1252text = encode(buffer5.toString('ascii'));
// // console.log('cp1252text contains: ', cp1252text);
// // console.log('cp1252text contains: ', decode(cp1252text));
// // console.log('cp1252text contains: ', decode(cp1252text).toString('hex'));

// // const filePath = '/Users/fernando/dev/conan-server/src/tmp/k-nuth/conan-packages/master/project1/2.0.0/_/_/9d9c0e529e2865cda9823c2c233f7d36/conan_sources_new.tgz';
// // fs.writeFile(filePath, cp1252text, (err) => {
// //     if (err) {
// //         console.error(`Error writing file: ${err}`);
// //     } else {
// //         console.log(`File saved as: ${filePath}`);
// //     }
// // });

// // console.log(`Buffer.isEncoding('ascii'): ${Buffer.isEncoding('ascii')}`);
// // console.log(`Buffer.isEncoding('ansi'): ${Buffer.isEncoding('ansi')}`);
// // console.log(`Buffer.isEncoding('latin1'): ${Buffer.isEncoding('latin1')}`);
// // console.log(`Buffer.isEncoding('cp1252'): ${Buffer.isEncoding('cp1252')}`);
// // console.log(`Buffer.isEncoding('windows-1252'): ${Buffer.isEncoding('windows-1252')}`);
// // console.log(`Buffer.isEncoding('binary'): ${Buffer.isEncoding('binary')}`);

// // console.log('ansi contains:    ', ansi);




// // function utf8ToAscii(str) {
// //     const enc = new TextEncoder('utf-8');
// //     const u8s = enc.encode(str);

// //     return Array.from(u8s).map(v => String.fromCharCode(v)).join('');
// // }

// // const buffer3 = Buffer.from(utf8ToAscii(str), 'ascii');
// // console.log('buffer3 contains: ', buffer3.toString('hex'));

// // ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------







// app.use(function (req, res, next) {
//     console.log("My custom middleware")
//     // const charset = contentType.parse(req).parameters.charset
//     // const charset = 'utf-8'
//     const charset = 'binary'

//     console.log(`middleware: req: ${req}`)

//     getRawBody(req, {
//       length: req.headers['content-length'],
//       limit: '1mb',
//       encoding: charset
//     }, function (err, string) {
//         console.log(`middleware: err: ${err}`)
//         console.log(`middleware: string: ${string}`)
//         if (err) return next(err)
//         req.text = string;
//         // req.text = encode(string);

//         const buffer = Buffer.from(string, 'utf8');
//         console.log('buffer contains: ', buffer.toString('hex'));


//         next()
//     })
// })