const { Router } = require('express');
const router = Router();
const fs = require('fs');
// const gh = require('../../dist/src/github/github.mjs');
// import { uploadToRepo } from './github'
const gh = require('./github.js');
const Octokit = require('@octokit/rest')
const os = require('os');
const path = require('path');


function getAuth(authHeader) {
    const credentials = authHeader.split(' ')[1];
    const decoded = Buffer.from(credentials, 'base64').toString();
    const [username, password] = decoded.split(':');
    return { username, password };
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

// Authentication ---------------------------------------------------------------

router.get('/api/:owner/:repo/:branch/v1/ping', (req, res) => {
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

router.get('/api/:owner/:repo/:branch/v2/users/authenticate', (req, res) => {
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

// GET /api/k-nuth/conan-packages/master/v2/users/check_credentials 404
router.get('/api/:owner/:repo/:branch/v2/users/check_credentials', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('x-client-id');
    const auth = req.header('Authorization');

    console.log(`Received request with headers:
      x-Client-Anonymous-Id: ${anonymousId}
      X-Client-Id: ${clientId}
      Authorization: ${auth}
    `);

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

router.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('X-Client-Id');
    const auth = req.header('Authorization');

    const { owner, repo, branch, recipe_name, version } = req.params;

    console.log(`Received request with headers:
      X-Client-Anonymous-Id: ${anonymousId}
      X-Client-Id: ${clientId}
      Authorization: ${auth}
    `);
    console.log(`Parameters:
      owner: ${owner}
      repo: ${repo}
      branch: ${branch}
      recipe_name: ${recipe_name}
      version: ${version}
    `);

    const reference = `${recipe_name}/${version}@_/_`;
    const revisions = [];
    const responseBody = { reference, revisions };
    res.status(200).json(responseBody);
});

async function checkIfExists(owner, repo, branch, recipe_name, version, revision, package_id, authorization) {
    const octo = new Octokit()
    const path = `${recipe_name}/${version}/_/_/revisions/${revision}/packages/${package_id}/latest.json`;
    console.log(`path: ${path}`)

    try {
        const content = await octo.repos.getContents({ owner, repo, path, ref: branch })
        console.log(`content: ${JSON.stringify(content)}`)
        // console.log(`content.data.download_url: ${content.data.download_url}`)
        return true;
    } catch (e) {
        console.log(`Error: ${e}`)
    }

    return false;
}

// /api/k-nuth/conan-packages/master/v2/conans/project1/2.0.0/_/_/revisions/9d9c0e529e2865cda9823c2c233f7d36/packages/35cb83beadb8b16663af2f47cf1e0d4d45834fa6/latest
router.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/latest', async (req, res) => {
    const { owner, repo, branch, recipe_name, version, revision, package_id } = req.params;

    const clientId = req.headers['X-Client-Id'];
    const anonymousId = req.headers['X-Client-Anonymous-Id'];
    const pkgIdSettings = req.headers['Conan-PkgID-Settings'];
    const authorization = req.headers['authorization'];

    console.log(`Received request with headers:
      X-Client-Anonymous-Id: ${anonymousId}
      X-Client-Id: ${clientId}
      Authorization: ${authorization}
      pkgIdSettings: ${pkgIdSettings}
      headers: ${JSON.stringify(req.headers)}
    `);
    console.log(`Parameters:
      owner: ${owner}
      repo: ${repo}
      branch: ${branch}
      recipe_name: ${recipe_name}
      version: ${version}
      revision: ${revision}
      package_id: ${package_id}
    `);

    const exists = await checkIfExists(owner, repo, branch, recipe_name, version, revision, package_id, authorization);

    if (exists) {
        const json = {
            "revision": "b331edceb4ca679e878ff10074a150f7",
            "time": "2023-03-20T21:51:26.503+0000"
        };
        res.status(200).json(json);
    } else {
        res.status(404).send();
    }
});

router.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/revisions/:package_revision/files', (req, res) => {
    console.log(`req.params: ${JSON.stringify(req.params)}`);
    console.log(`req.headers: ${JSON.stringify(req.headers)}`);
    console.log(`req.body: ${JSON.stringify(req.body)}`);

    res.status(404).send('Not found');
});

// PUT endpoints ---------------------------------------------------------------


function createTempDir() {

    const tmpDirBase = path.resolve(path.join(__dirname, 'tmp/'));
    console.log(`tmpDirBase: ${tmpDirBase}`)

    if (!fs.existsSync(tmpDirBase)) {
      fs.mkdirSync(tmpDirBase);
    }

    // // OR
    // if (!fs.existsSync(dir)) {
    //   fs.mkdirSync(dir, {
    //     mode: 0o744, // Not supported on Windows. Default: 0o777
    //   });
    // }

    let tmpDir;
    const appPrefix = 'upload-';
    try {
    //   tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), appPrefix));
      tmpDir = fs.mkdtempSync(path.join(tmpDirBase, appPrefix));
    //   tmpDir = fs.mkdtempSync(`./tmp/`);
    //   tmpDir = fs.mkdtempSync(tmpDirBase);
      console.log(`tmpDir: ${tmpDir}`);
      // the rest of your app goes here
    //   return tmpDir;
        return tmpDirBase;
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

router.put('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/files/:file_name', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('X-Client-Id');
    const auth = req.header('Authorization');
    const checksumDeploy = req.header('X-Checksum-Deploy');
    const checksumSha1 = req.header('X-Checksum-Sha1');

    if (checksumDeploy === 'true') {
        // console.log(`checksumDeploy: ${checksumDeploy}`);
        // console.log(`checksumSha1: ${checksumSha1}`);

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

    // console.log(`Received request with headers:
    //     X-Client-Anonymous-Id: ${anonymousId}
    //     X-Client-Id: ${clientId}
    //     Authorization: ${auth}
    //     `);
    // console.log(`Parameters:
    //     owner: ${owner}
    //     repo: ${repo}
    //     branch: ${branch}
    //     recipe_name: ${recipe_name}
    //     version: ${version}
    //     revision: ${revision}
    //     file_name: ${file_name}
    //     `);

    console.log(`Received request headers: ${JSON.stringify(req.headers)}`);

    const tmpDir = createTempDir();
    if ( ! tmpDir) {
        console.error(`Error creating temp dir`);
        res.status(500).send();
        return;
    }

    console.log(`tmpDir: ${tmpDir}`);

    const fileContent = req.body;
    // const fileContent = req.body.toString('binary');
    // const fileContent = req.body.toString('utf8');
    // const fileContent = req.rawBody;

    const dirPath = `${tmpDir}/${owner}/${repo}/${branch}/${recipe_name}/${version}/_/_/${revision}`;
    const filePath = `${dirPath}/${file_name}`;

    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    console.log(`filePath: ${filePath}`);
    console.log(`fileContent: ${fileContent}`);
    // console.log(`fileContent: ${JSON.stringify(fileContent)}`);

    res.status(500).send();
    return;

    fs.writeFile(filePath, fileContent, (err) => {
        if (err) {
            console.error(`Error writing file: ${err}`);
            res.status(500).send();
        } else {
            console.log(`File saved as: ${filePath}`);
            res.status(200).send();
        }
    });

});

module.exports = router;