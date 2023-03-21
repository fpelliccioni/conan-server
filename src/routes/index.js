const { Router } = require('express');
const router = Router();
const fs = require('fs');


router.get('/api/:remote/v1/ping', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('X-Client-Id');
    const auth = req.header('Authorization');

    const { remote } = req.params;

    console.log(`Received request with headers:
      X-Client-Anonymous-Id: ${anonymousId}
      X-Client-Id: ${clientId}
      Authorization: ${auth}
    `);
    console.log(`Parameters:
      remote: ${remote}
    `);

    res.set('X-Conan-Server-Version', '0.20.0');
    res.set('X-Conan-Server-Capabilities', 'complex_search,checksum_deploy,revisions,matrix_params');
    res.status(200).send();
});

router.get('/api/:remote/v2/users/authenticate', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('X-Client-Id');
    const auth = req.header('Authorization');

    const authHeader = req.headers.authorization;
    const credentials = authHeader.split(' ')[1];
    const decoded = Buffer.from(credentials, 'base64').toString();
    const [username, password] = decoded.split(':');

    // Log headers
    console.log(`Received request with headers:
      X-Client-Anonymous-Id: ${anonymousId}
      X-Client-Id: ${clientId}
      Authorization: ${auth}
      decoded: ${decoded}
      username: ${username}
      password: ${password}
    `);

    const requestBody = req.body;
    console.log(`Received request body: ${requestBody}`);
    res.status(200).send();
});

router.get('/api/:remote/v2/conans/:recipe_name/:version/_/_/revisions', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('X-Client-Id');
    const auth = req.header('Authorization');

    const { remote, recipe_name, version } = req.params;

    console.log(`Received request with headers:
      X-Client-Anonymous-Id: ${anonymousId}
      X-Client-Id: ${clientId}
      Authorization: ${auth}
    `);
    console.log(`Parameters:
      remote: ${remote}
      recipe_name: ${recipe_name}
      version: ${version}
    `);

    const reference = `${recipe_name}/${version}@_/_`;
    const revisions = [];
    const responseBody = { reference, revisions };
    res.status(200).json(responseBody);
});


function checkIfExists(remote, recipeName, version, revision, packageId, authorization) {
    return true;
}

router.get('/api/:remote/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/latest', (req, res) => {
    const remote = req.params.remote;
    const recipeName = req.params.recipe_name;
    const version = req.params.version;
    const revision = req.params.revision;
    const packageId = req.params.package_id;
    const clientId = req.headers['X-Client-Id'];
    const anonymousId = req.headers['X-Client-Anonymous-Id'];
    const pkgIdSettings = req.headers['Conan-PkgID-Settings'];
    const authorization = req.headers['authorization'];

    const exists = checkIfExists(remote, recipeName, version, revision, packageId, authorization);

    if (exists) {
        const json = {
            "revision": "b331edceb4ca679e878ff10074a150f7",
            "time": "2023-03-20T21:51:26.503+0000"
        };
        res.status(200).json(json);
    } else {
        res.status(404).send('Not found');
    }
});

router.get('/api/:remote/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/revisions/:package_revision/files', (req, res) => {
    console.log(`req.params: ${JSON.stringify(req.params)}`);
    console.log(`req.headers: ${JSON.stringify(req.headers)}`);
    console.log(`req.body: ${JSON.stringify(req.body)}`);

    res.status(404).send('Not found');
});

// PUT endpoints ---------------------------------------------------------------

router.put('/api/:remote/v2/conans/:recipe_name/:version/_/_/revisions/:revision/files/:file_name', (req, res) => {
    const anonymousId = req.header('X-Client-Anonymous-Id');
    const clientId = req.header('X-Client-Id');
    const auth = req.header('Authorization');

    const { remote, recipe_name, version, revision, file_name } = req.params;

    console.log(`Received request with headers:
        X-Client-Anonymous-Id: ${anonymousId}
        X-Client-Id: ${clientId}
        Authorization: ${auth}
        `);
    console.log(`Parameters:
        remote: ${remote}
        recipe_name: ${recipe_name}
        version: ${version}
        revision: ${revision}
        file_name: ${file_name}
        `);

    const fileContent = req.body;
    const filePath = `${remote}/${recipe_name}/${version}/_/_/${revision}/${file_name}`;
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