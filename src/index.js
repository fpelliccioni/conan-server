// // const express = require('express');
// import express from 'express';
// const app = express();
// // const bodyParser = require('body-parser')
// // const morgan=require('morgan');


// // const fs = require('fs');
// import fs from 'fs';

// // const gh = require('../../dist/src/github/github.mjs');
// // import { uploadToRepo } from './github'
// // const gh = require('./github.js');

// // const Octokit = require('@octokit/rest')
// import Octokit from '@octokit/rest';

// // const os = require('os');
// // import os from 'os';

// // const path = require('path');
// import path from 'path';


// import {encode, decode, labels} from 'windows-1252';

// // var contentType = require('content-type')
// // var getRawBody = require('raw-body')
// import getRawBody from 'raw-body';


// app.set('port', process.env.PORT || 8081);
// app.set('json spaces', 2)



// app.use(function (req, res, next) {
//     console.log("My custom middleware")
//     // const charset = contentType.parse(req).parameters.charset
//     // const charset = 'utf-8'
//     const charset = 'ascii'

//     console.log(`middleware: req: ${req}`)

//     getRawBody(req, {
//       length: req.headers['content-length'],
//       limit: '1mb',
//       encoding: charset
//     }, function (err, string) {
//         console.log(`middleware: err: ${err}`)
//         console.log(`middleware: string: ${string}`)
//         if (err) return next(err)
//         req.text = encode(string);
//         next()
//     })
// })





// // const cp1252text = encode(hexString);
// // console.log('cp1252text contains: ', cp1252text);
// // console.log('cp1252text contains: ', decode(cp1252text));




// // const router = Router();

// function getAuth(authHeader) {
//     const credentials = authHeader.split(' ')[1];
//     const decoded = Buffer.from(credentials, 'base64').toString();
//     const [username, password] = decoded.split(':');
//     return { username, password };
// }

// function writeCommonHeaders(res) {
//     // Set these headers:
//     // X-JFrog-Version: Artifactory/7.55.6 75506900
//     // X-Artifactory-Id: 78cd56d518ee33a1:301d323a:18704509130:-8000
//     // X-Artifactory-Node-Id: aca04be74fe9
//     // X-Conan-Server-Version: 0.20.0
//     // X-Conan-Server-Capabilities: complex_search,checksum_deploy,revisions,matrix_params
//     // Content-Length: 0
//     // Date: Tue, 21 Mar 2023 13:25:17 GMT
//     // Keep-Alive: timeout=60
//     // Connection: keep-alive

//     res.set('X-JFrog-Version', 'Artifactory/7.55.6 75506900');
//     res.set('X-Artifactory-Id', '78cd56d518ee33a1:301d323a:18704509130:-8000');
//     res.set('X-Artifactory-Node-Id', 'aca04be74fe9');
//     res.set('X-Conan-Server-Version', '0.20.0');
//     res.set('X-Conan-Server-Capabilities', 'complex_search,checksum_deploy,revisions,matrix_params');
// }

// // Authentication ---------------------------------------------------------------

// app.get('/api/:owner/:repo/:branch/v1/ping', (req, res) => {
//     const anonymousId = req.header('X-Client-Anonymous-Id');
//     const clientId = req.header('X-Client-Id');
//     const auth = req.header('Authorization');

//     const { owner, repo, branch } = req.params;

//     // console.log(`Received request with headers:
//     //   X-Client-Anonymous-Id: ${anonymousId}
//     //   X-Client-Id: ${clientId}
//     //   Authorization: ${auth}
//     // `);
//     // console.log(`Parameters:
//     //     owner: ${owner}
//     //     repo: ${repo}
//     //     branch: ${branch}
//     // `);

//     writeCommonHeaders(res);
//     res.status(200).send();
// });

// app.get('/api/:owner/:repo/:branch/v2/users/authenticate', (req, res) => {
//     const anonymousId = req.header('X-Client-Anonymous-Id');
//     const clientId = req.header('X-Client-Id');
//     const auth = req.header('Authorization');

//     const { username, password } = getAuth(auth);

//     // // Log headers
//     // console.log(`Received request with headers:
//     //   X-Client-Anonymous-Id: ${anonymousId}
//     //   X-Client-Id: ${clientId}
//     //   Authorization: ${auth}
//     //   username: ${username}
//     //   password: ${password}
//     // `);

//     const requestBody = req.body;
//     // console.log(`Received request body: ${requestBody}`);
//     writeCommonHeaders(res);
//     res.status(200).send(password);
// });

// // GET /api/k-nuth/conan-packages/master/v2/users/check_credentials 404
// app.get('/api/:owner/:repo/:branch/v2/users/check_credentials', (req, res) => {
//     const anonymousId = req.header('X-Client-Anonymous-Id');
//     const clientId = req.header('x-client-id');
//     const auth = req.header('Authorization');

//     console.log(`Received request with headers:
//       x-Client-Anonymous-Id: ${anonymousId}
//       X-Client-Id: ${clientId}
//       Authorization: ${auth}
//     `);

//     const { username, password } = getAuth(auth);

//     // Log headers
//     // console.log(`Received request with headers:
//     //   X-Client-Anonymous-Id: ${anonymousId}
//     //   X-Client-Id: ${clientId}
//     //   Authorization: ${auth}
//     //   username: ${username}
//     //   password: ${password}
//     // `);

//     // console.log(`Received request body: ${JSON.stringify(req.body)}`);
//     // console.log(`Received request headers: ${JSON.stringify(req.headers)}`);
//     // console.log(`Received request params: ${JSON.stringify(req.params)}`);

//     writeCommonHeaders(res);

//     // res.status(404).send();
//     res.status(200).send();
// });



// // Get Recipe Informaton --------------------------------------------------------

// app.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions', (req, res) => {
//     const anonymousId = req.header('X-Client-Anonymous-Id');
//     const clientId = req.header('X-Client-Id');
//     const auth = req.header('Authorization');

//     const { owner, repo, branch, recipe_name, version } = req.params;

//     console.log(`Received request with headers:
//       X-Client-Anonymous-Id: ${anonymousId}
//       X-Client-Id: ${clientId}
//       Authorization: ${auth}
//     `);
//     console.log(`Parameters:
//       owner: ${owner}
//       repo: ${repo}
//       branch: ${branch}
//       recipe_name: ${recipe_name}
//       version: ${version}
//     `);

//     const reference = `${recipe_name}/${version}@_/_`;
//     const revisions = [];
//     const responseBody = { reference, revisions };
//     res.status(200).json(responseBody);
// });

// async function checkIfExists(owner, repo, branch, recipe_name, version, revision, package_id, authorization) {
//     const octo = new Octokit()
//     const path = `${recipe_name}/${version}/_/_/revisions/${revision}/packages/${package_id}/latest.json`;
//     console.log(`path: ${path}`)

//     try {
//         const content = await octo.repos.getContents({ owner, repo, path, ref: branch })
//         console.log(`content: ${JSON.stringify(content)}`)
//         // console.log(`content.data.download_url: ${content.data.download_url}`)
//         return true;
//     } catch (e) {
//         console.log(`Error: ${e}`)
//     }

//     return false;
// }

// // /api/k-nuth/conan-packages/master/v2/conans/project1/2.0.0/_/_/revisions/9d9c0e529e2865cda9823c2c233f7d36/packages/35cb83beadb8b16663af2f47cf1e0d4d45834fa6/latest
// app.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/latest', async (req, res) => {
//     const { owner, repo, branch, recipe_name, version, revision, package_id } = req.params;

//     const clientId = req.headers['X-Client-Id'];
//     const anonymousId = req.headers['X-Client-Anonymous-Id'];
//     const pkgIdSettings = req.headers['Conan-PkgID-Settings'];
//     const authorization = req.headers['authorization'];

//     console.log(`Received request with headers:
//       X-Client-Anonymous-Id: ${anonymousId}
//       X-Client-Id: ${clientId}
//       Authorization: ${authorization}
//       pkgIdSettings: ${pkgIdSettings}
//       headers: ${JSON.stringify(req.headers)}
//     `);
//     console.log(`Parameters:
//       owner: ${owner}
//       repo: ${repo}
//       branch: ${branch}
//       recipe_name: ${recipe_name}
//       version: ${version}
//       revision: ${revision}
//       package_id: ${package_id}
//     `);

//     const exists = await checkIfExists(owner, repo, branch, recipe_name, version, revision, package_id, authorization);

//     if (exists) {
//         const json = {
//             "revision": "b331edceb4ca679e878ff10074a150f7",
//             "time": "2023-03-20T21:51:26.503+0000"
//         };
//         res.status(200).json(json);
//     } else {
//         res.status(404).send();
//     }
// });

// app.get('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/packages/:package_id/revisions/:package_revision/files', (req, res) => {
//     console.log(`req.params: ${JSON.stringify(req.params)}`);
//     console.log(`req.headers: ${JSON.stringify(req.headers)}`);
//     console.log(`req.body: ${JSON.stringify(req.body)}`);

//     res.status(404).send('Not found');
// });

// // PUT endpoints ---------------------------------------------------------------


// function createTempDir() {

//     const tmpDirBase = path.resolve(path.join(__dirname, 'tmp/'));
//     console.log(`tmpDirBase: ${tmpDirBase}`)

//     if (!fs.existsSync(tmpDirBase)) {
//       fs.mkdirSync(tmpDirBase);
//     }

//     // // OR
//     // if (!fs.existsSync(dir)) {
//     //   fs.mkdirSync(dir, {
//     //     mode: 0o744, // Not supported on Windows. Default: 0o777
//     //   });
//     // }

//     let tmpDir;
//     const appPrefix = 'upload-';
//     try {
//     //   tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), appPrefix));
//       tmpDir = fs.mkdtempSync(path.join(tmpDirBase, appPrefix));
//     //   tmpDir = fs.mkdtempSync(`./tmp/`);
//     //   tmpDir = fs.mkdtempSync(tmpDirBase);
//       console.log(`tmpDir: ${tmpDir}`);
//       // the rest of your app goes here
//     //   return tmpDir;
//         return tmpDirBase;
//     }
//     catch {
//       // handle error
//     }
//     finally {
//       try {
//         if (tmpDir) {
//           fs.rmSync(tmpDir, { recursive: true });
//         }
//       }
//       catch (e) {
//         console.error(`An error has occurred while removing the temp folder at ${tmpDir}. Please remove it manually. Error: ${e}`);
//       }
//     }
//     return undefined;
// }

// app.put('/api/:owner/:repo/:branch/v2/conans/:recipe_name/:version/_/_/revisions/:revision/files/:file_name', (req, res) => {
//     const anonymousId = req.header('X-Client-Anonymous-Id');
//     const clientId = req.header('X-Client-Id');
//     const auth = req.header('Authorization');
//     const checksumDeploy = req.header('X-Checksum-Deploy');
//     const checksumSha1 = req.header('X-Checksum-Sha1');

//     if (checksumDeploy === 'true') {
//         // console.log(`checksumDeploy: ${checksumDeploy}`);
//         // console.log(`checksumSha1: ${checksumSha1}`);

//         const json = {
//             "errors": [
//                 {
//                     "status": 404,
//                     "message": `Checksum deploy failed. No existing file with SHA1: ${checksumSha1}`
//                 }
//             ]
//         };
//         res.status(404).json(json);
//         return;
//     }

//     const { owner, repo, branch, recipe_name, version, revision, file_name } = req.params;

//     // console.log(`Received request with headers:
//     //     X-Client-Anonymous-Id: ${anonymousId}
//     //     X-Client-Id: ${clientId}
//     //     Authorization: ${auth}
//     //     `);
//     // console.log(`Parameters:
//     //     owner: ${owner}
//     //     repo: ${repo}
//     //     branch: ${branch}
//     //     recipe_name: ${recipe_name}
//     //     version: ${version}
//     //     revision: ${revision}
//     //     file_name: ${file_name}
//     //     `);

//     console.log(`Received request headers: ${JSON.stringify(req.headers)}`);

//     const tmpDir = createTempDir();
//     if ( ! tmpDir) {
//         console.error(`Error creating temp dir`);
//         res.status(500).send();
//         return;
//     }

//     console.log(`tmpDir: ${tmpDir}`);

//     // const fileContent = req.body;
//     // const fileContent = req.body.toString('binary');
//     // const fileContent = req.body.toString('utf8');
//     // const fileContent = req.rawBody;
//     const fileContent = req.text;

//     const dirPath = `${tmpDir}/${owner}/${repo}/${branch}/${recipe_name}/${version}/_/_/${revision}`;
//     const filePath = `${dirPath}/${file_name}`;

//     if (!fs.existsSync(dirPath)) {
//         fs.mkdirSync(dirPath, { recursive: true });
//     }

//     console.log(`filePath: ${filePath}`);
//     console.log(`fileContent: ${fileContent}`);
//     // console.log(`req.text: ${req.text}`);
//     // console.log(`fileContent: ${JSON.stringify(fileContent)}`);

//     // res.status(500).send();
//     // return;

//     fs.writeFile(filePath, fileContent, (err) => {
//         if (err) {
//             console.error(`Error writing file: ${err}`);
//             res.status(500).send();
//         } else {
//             console.log(`File saved as: ${filePath}`);
//             res.status(200).send();
//         }
//     });

// });



// app.listen(app.get('port'),()=>{
//     console.log(`Server listening on port ${app.get('port')}`);
// });



// // // app.use(bodyParser.raw({ type: 'application/vnd.custom-type' }))
// // app.use(bodyParser.raw({ type: '*/*' }))
// // app.use(bodyParser.json({ type: 'application/*+json' }))
// // // app.use(bodyParser.raw())
// // app.use(bodyParser.text({ type: 'text/html' }))



// // app.use(bodyParser.json({ verify: (req, res, buf, encoding) => {
// //     console.log(`buf: ${buf}`)
// //     console.log(`buf.length: ${buf.length}`)
// //     console.log(`encoding: ${encoding}`)
// //     if (buf && buf.length) {
// //         req.rawBody = buf.toString(encoding || 'utf8');
// //     }
// // }, extended: true }));


// // app.use(bodyParser.raw({ verify: (req, res, buf, encoding) => {
// //     console.log(`buf: ${buf}`)
// //     console.log(`buf.length: ${buf.length}`)
// //     console.log(`encoding: ${encoding}`)
// //     if (buf && buf.length) {
// //         req.rawBody = buf.toString(encoding || 'utf8');
// //     }
// // }, extended: true }));


// // app.use(bodyParser.text({ verify: (req, res, buf, encoding) => {
// //     console.log(`buf: ${buf}`)
// //     console.log(`buf.length: ${buf.length}`)
// //     console.log(`encoding: ${encoding}`)
// //     if (buf && buf.length) {
// //         req.rawBody = buf.toString(encoding || 'utf8');
// //     }
// // }, extended: true }));



// // // app.use(morgan('dev'));
// // app.use(express.urlencoded({extended:false}));
// // // app.use(express.json());
// // app.use(express.text());
// // // app.use(express.raw());

// // app.use(
// //     express.json({
// //     //   limit: '5mb',
// //       verify: (req, res, buf) => {
// //         req.rawBody = buf.toString();
// //         console.log(`req.rawBody: ${req.rawBody}`)
// //       },
// //     })
// // );

// // app.use(
// //     express.raw({
// //     //   limit: '5mb',
// //       verify: (req, res, buf) => {
// //         req.rawBody = buf.toString();
// //         console.log(`req.rawBody: ${req.rawBody}`)
// //       },
// //     })
// // );

// // app.use(require('./routes/index'));

// // app.use(express.static({ verify: (req, res, buf, encoding) => {
// //     console.log(`buf: ${buf}`)
// //     console.log(`buf.length: ${buf.length}`)
// //     console.log(`encoding: ${encoding}`)
// //     if (buf && buf.length) {
// //         req.rawBody = buf.toString(encoding || 'utf8');
// //     }
// // }, extended: true }));


// // app.use(express.json({ verify: (req, res, buf, encoding) => {
// //     console.log(`buf: ${buf}`)
// //     console.log(`buf.length: ${buf.length}`)
// //     console.log(`encoding: ${encoding}`)
// //     if (buf && buf.length) {
// //         req.rawBody = buf.toString(encoding || 'utf8');
// //     }
// // }, extended: true }));


// // app.use(express.raw({ verify: (req, res, buf, encoding) => {
// //     console.log(`buf: ${buf}`)
// //     console.log(`buf.length: ${buf.length}`)
// //     console.log(`encoding: ${encoding}`)
// //     if (buf && buf.length) {
// //         req.rawBody = buf.toString(encoding || 'utf8');
// //     }
// // }, extended: true }));


// // app.use(express.text({ verify: (req, res, buf, encoding) => {
// //     console.log(`buf: ${buf}`)
// //     console.log(`buf.length: ${buf.length}`)
// //     console.log(`encoding: ${encoding}`)
// //     if (buf && buf.length) {
// //         req.rawBody = buf.toString(encoding || 'utf8');
// //     }
// // }, extended: true }));



import chardet from 'chardet';
import { toByteArray, utf8ToAnsi } from 'utf8-to-ansi'
import { encode, decode } from 'windows-1252';
import fs from 'fs';

const originalFilePath = `/Users/fernando/dev/conan-server/src/tmp/k-nuth/conan-packages/master/project1/2.0.0/_/_/9d9c0e529e2865cda9823c2c233f7d36/conan_sources.tgz`
const binary = fs.readFileSync(originalFilePath, { encoding: 'binary' });
console.log('binary contains: ', binary.toString('hex'));

const newFilePath = '/Users/fernando/dev/conan-server/src/tmp/k-nuth/conan-packages/master/project1/2.0.0/_/_/9d9c0e529e2865cda9823c2c233f7d36/conan_sources_new.tgz';
fs.writeFile(newFilePath, binary, (err) => {
    if (err) {
        console.error(`Error writing file: ${err}`);
    } else {
        console.log(`File saved as: ${newFilePath}`);
    }
});

// // const hexString = '1f8b08080000000002ff636f6e616e5f';
// const hexString = '1fefbfbd08080000000002efbfbd636f6e616e5f';
// const buffer1 = Buffer.from(hexString, 'hex');

// const encoding = chardet.detect(buffer1);
// console.log(`encoding: ${encoding}`);

// const str = buffer1.toString('utf8');
// const buffer2 = Buffer.from(str, 'utf8');

// console.log('original content: ', hexString);
// console.log('buffer1 contains: ', buffer1.toString('hex'));
// console.log('str contains:     ', str);
// console.log('buffer2 contains: ', buffer2.toString('hex'));


// // // const cp1252text = windows1252.encode(hexString);
// // const cp1252text = windows1252.encode(buffer2.buffer);
// // console.log('cp1252text contains: ', cp1252text);
// // console.log('cp1252text contains: ', windows1252.decode(cp1252text));


// // const {utf8ToAnsi, toByteArray} = require('utf8-to-ansi');

// const buffer4 = new Buffer.from(toByteArray(str))
// // console.log(buffer4.toString('hex'))
// console.log('buffer4 contains: ', buffer4.toString('hex'));

// const ansi = utf8ToAnsi(str)
// const buffer5 = Buffer.from(ansi, 'ascii');
// console.log('buffer5 contains: ', buffer5.toString('hex'));
// console.log('buffer5 contains: ', buffer5.toString('ascii'));
// console.log('buffer5 contains: ', buffer5.toString());
// console.log('buffer5 contains: ', buffer5.toString('utf-8'));

// const cp1252text = encode(buffer5.toString('ascii'));
// console.log('cp1252text contains: ', cp1252text);
// console.log('cp1252text contains: ', decode(cp1252text));
// console.log('cp1252text contains: ', decode(cp1252text).toString('hex'));

// const filePath = '/Users/fernando/dev/conan-server/src/tmp/k-nuth/conan-packages/master/project1/2.0.0/_/_/9d9c0e529e2865cda9823c2c233f7d36/conan_sources_new.tgz';
// fs.writeFile(filePath, cp1252text, (err) => {
//     if (err) {
//         console.error(`Error writing file: ${err}`);
//     } else {
//         console.log(`File saved as: ${filePath}`);
//     }
// });

// console.log(`Buffer.isEncoding('ascii'): ${Buffer.isEncoding('ascii')}`);
// console.log(`Buffer.isEncoding('ansi'): ${Buffer.isEncoding('ansi')}`);
// console.log(`Buffer.isEncoding('latin1'): ${Buffer.isEncoding('latin1')}`);
// console.log(`Buffer.isEncoding('cp1252'): ${Buffer.isEncoding('cp1252')}`);
// console.log(`Buffer.isEncoding('windows-1252'): ${Buffer.isEncoding('windows-1252')}`);
// console.log(`Buffer.isEncoding('binary'): ${Buffer.isEncoding('binary')}`);

// console.log('ansi contains:    ', ansi);




// function utf8ToAscii(str) {
//     const enc = new TextEncoder('utf-8');
//     const u8s = enc.encode(str);

//     return Array.from(u8s).map(v => String.fromCharCode(v)).join('');
// }

// const buffer3 = Buffer.from(utf8ToAscii(str), 'ascii');
// console.log('buffer3 contains: ', buffer3.toString('hex'));
