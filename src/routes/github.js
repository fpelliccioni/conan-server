import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import Octokit from '@octokit/rest';
import path from 'path';
import pkg from 'fs-extra';
const { readFile } = pkg;

import {globby} from 'globby';
// import { http, https } from 'follow-redirects';
import pkg2 from 'follow-redirects';
const { http, https } = pkg2;

export const uploadToRepo = async (personalAccessToken, coursePath, org, repo, branch, commitMessage) => {
  const octo = new Octokit({
    auth: personalAccessToken,
  })

  // console.log(`coursePath: ${coursePath}`)
  // console.log(`org:        ${org}`)
  // console.log(`repo:       ${repo}`)
  // console.log(`branch:     ${branch}`)
  // console.log(`personalAccessToken: ${personalAccessToken}`)

  await uploadToRepoInternal(octo, coursePath, org, repo, branch, commitMessage)
}

const uploadToRepoInternal = async (octo, coursePath, org, repo, branch, commitMessage) => {
  // gets commit's AND its tree's SHA
  const currentCommit = await getCurrentCommit(octo, org, repo, branch)
  // console.log(`currentCommit: ${JSON.stringify(currentCommit)}`)

  const filesPaths = await globby(coursePath)
  const filesBlobs = await Promise.all(filesPaths.map(createBlobForFile(octo, org, repo)))

  const pathsForBlobs = filesPaths.map(fullPath => path.relative(coursePath, fullPath))

  // console.log(`currentCommit: ${JSON.stringify(currentCommit)}`)
  // console.log(`filesPaths:    ${filesPaths}`)
  // console.log(`filesBlobs:    ${filesBlobs}`)
  // console.log(`pathsForBlobs: ${pathsForBlobs}`)

  const newTree = await createNewTree(
    octo,
    org,
    repo,
    filesBlobs,
    pathsForBlobs,
    currentCommit.treeSha
  )

  // console.log(`newTree:       ${newTree}`)

  const newCommit = await createNewCommit(
    octo,
    org,
    repo,
    commitMessage,
    newTree.sha,
    currentCommit.commitSha
  )
  // console.log(`newCommit:     ${newCommit}`)

  await setBranchToCommit(octo, org, repo, branch, newCommit.sha)
}

const getCurrentCommit = async (
  octo,
  org,
  repo,
  branch = 'master'
) => {
  const { data: refData } = await octo.git.getRef({
    owner: org,
    repo,
    ref: `heads/${branch}`,
  })
  const commitSha = refData.object.sha
  const { data: commitData } = await octo.git.getCommit({
    owner: org,
    repo,
    commit_sha: commitSha,
  })
  return {
    commitSha,
    treeSha: commitData.tree.sha,
  }
}

// Notice that readFile's utf8 is typed differently from Github's utf-8
const getFileAsUTF8 = (filePath) => readFile(filePath, 'utf8')
const getFileAsBase64 = (filePath) => {
  return readFile(filePath, 'base64')
}

const getFileSmart = (filePath) => {
  const extension = path.extname(filePath)
  if (extension === '.tgz') {
    return getFileAsBase64(filePath)
  }

  return getFileAsUTF8(filePath)
}

const getEncoding = (filePath) => {
  const extension = path.extname(filePath)
  if (extension === '.tgz') {
    return 'base64';
  }

  return 'utf-8'
}

const createBlobForFile = (octo, org, repo) => async (
  filePath
) => {
  // const content = await getFileAsUTF8(filePath)
  // const blobData = await octo.git.createBlob({
  //   owner: org,
  //   repo,
  //   content,
  //   encoding: 'utf-8',
  // })
  // return blobData.data

  const content = await getFileSmart(filePath)
  const blobData = await octo.git.createBlob({
    owner: org,
    repo,
    content,
    encoding: getEncoding(filePath),
  })

  // console.log(`filePath: ${filePath}`)
  // console.log(`content: ${content}`)
  // console.log(`blobData: ${JSON.stringify(blobData)}`)

  return blobData.data

}

const createNewTree = async (
  octo,
  owner,
  repo,
  blobs,
  paths,
  parentTreeSha
) => {
  // My custom config. Could be taken as parameters
  const tree = blobs.map(({ sha }, index) => ({
    path: paths[index],
    mode: `100644`,
    type: `blob`,
    sha,
  }))
  const { data } = await octo.git.createTree({
    owner,
    repo,
    tree,
    base_tree: parentTreeSha,
  })
  return data
}

const createNewCommit = async (
  octo,
  org,
  repo,
  message,
  currentTreeSha,
  currentCommitSha
) =>
  (await octo.git.createCommit({
    owner: org,
    repo,
    message,
    tree: currentTreeSha,
    parents: [currentCommitSha],
  })).data

const setBranchToCommit = (
  octo,
  org,
  repo,
  branch,
  commitSha
) => {
  octo.git.updateRef({
      owner: org,
      repo,
      ref: `heads/${branch}`,
      sha: commitSha,
  })
}

// const main = async () => {
//   const ORGANIZATION = `k-nuth`
//   const REPO = `conan-packages`
//   const BRANCH = `master`

//   // await uploadToRepo(octo, `./files-to-upload/c.dir/c.txt`, ORGANIZATION, REPO)
//   // await uploadToRepo(process.env.PERSONAL_ACESSS_TOKEN, `./files-to-upload/`, ORGANIZATION, REPO, BRANCH)

//   // await uploadToRepo(process.env.PERSONAL_ACESSS_TOKEN, `./files-to-upload/d.txt`, ORGANIZATION, REPO, BRANCH)
//   await uploadToRepo(process.env.PERSONAL_ACESSS_TOKEN, `./files-to-upload/`, ORGANIZATION, REPO, BRANCH)
// }

// main()

// const createRepo = async (octo, org, name) => {
//   await octo.repos.createInOrg({ org, name, auto_init: true })
// }




// const main = async () => {
//   // console.log(`process.env.PERSONAL_ACESSS_TOKEN: ${process.env.PERSONAL_ACESSS_TOKEN}`)

//   // There are other ways to authenticate, check https://developer.github.com/v3/#authentication
//   const octo = new Octokit({
//     auth: process.env.PERSONAL_ACESSS_TOKEN,
//   })

//   // https://github.com/k-nuth/conan-packages

//   // For this, I was working on a organization repos, but it works for common repos also (replace org for owner)
//   const ORGANIZATION = `k-nuth`
//   const REPO = `conan-packages`
//   const repos = await octo.repos.listForOrg({
//     org: ORGANIZATION,
//   })
//   // if (!repos.data.map((repo: Octokit.ReposListForOrgResponseItem) => repo.name).includes(REPO)) {
//   //   await createRepo(octo, ORGANIZATION, REPO)
//   // }
//   /**
//    * my-local-folder has files on its root, and subdirectories with files
//    */
//   // await uploadToRepo(octo, `./files-to-upload/c.dir/c.txt`, ORGANIZATION, REPO)
//   await uploadToRepo(octo, `./files-to-upload/`, ORGANIZATION, REPO)
// }



// module.exports = {
//   uploadToRepo,
// }