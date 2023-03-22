const { Router } = require('express');
const router = Router();
const fs = require('fs');
// const gh = require('../../dist/src/github/github.mjs');
// import { uploadToRepo } from './github'
const gh = require('./github.js');
const Octokit = require('@octokit/rest')

function getAuth(authHeader) {
    const credentials = authHeader.split(' ')[1];
    const decoded = Buffer.from(credentials, 'base64').toString();
    const [username, password] = decoded.split(':');
    return { username, password };
}

router.get('/api/:owner/:repo/:branch/v1/ping', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('X-Client-Id');
    const auth = req.header('Authorization');

    const { owner, repo, branch } = req.params;

    console.log(`Received request with headers:
      X-Client-Anonymous-Id: ${anonymousId}
      X-Client-Id: ${clientId}
      Authorization: ${auth}
    `);
    console.log(`Parameters:
        owner: ${owner}
        repo: ${repo}
        branch: ${branch}
    `);

    res.set('X-Conan-Server-Version', '0.20.0');
    res.set('X-Conan-Server-Capabilities', 'complex_search,checksum_deploy,revisions,matrix_params');
    res.status(200).send();
});

router.get('/api/:owner/:repo/:branch/v2/users/authenticate', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('X-Client-Id');
    const auth = req.header('Authorization');

    const { username, password } = getAuth(auth);

    // Log headers
    console.log(`Received request with headers:
      X-Client-Anonymous-Id: ${anonymousId}
      X-Client-Id: ${clientId}
      Authorization: ${auth}
      username: ${username}
      password: ${password}
    `);

    const requestBody = req.body;
    console.log(`Received request body: ${requestBody}`);
    res.status(200).send();
});

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

router.put('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/files/:file_name', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('X-Client-Id');
    const auth = req.header('Authorization');

    const { owner, repo, branch, recipe_name, version, revision, file_name } = req.params;

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
        revision: ${revision}
        file_name: ${file_name}
        `);

    const fileContent = req.body;
    const filePath = `${owner}/${repo}/${branch}/${recipe_name}/${version}/_/_/${revision}/${file_name}`;
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