// const dotenv = require('dotenv');

import dotenv from 'dotenv'
dotenv.config();

import Octokit from '@octokit/rest'
import { globby } from 'globby'
import path from 'path'
import pkg from 'fs-extra';
const { readFile } = pkg;

import pkg2 from 'follow-redirects';
const { https } = pkg2;

import fs from 'fs';

export const uploadToRepo = async (
  personalAccessToken: string,
  coursePath: string,
  org: string,
  repo: string,
  branch: string
) => {
  const octo = new Octokit({
    auth: personalAccessToken,
  })

  await uploadToRepoInternal(octo, coursePath, org, repo, branch)
}

const uploadToRepoInternal = async (
  octo: Octokit,
  coursePath: string,
  org: string,
  repo: string,
  branch: string
) => {

  // const repoInfo = await octo.repos.get({owner: org, repo});
  // console.log(`repoInfo: ${JSON.stringify(repoInfo)}`)


  // const branchInfo = await octo.repos.getBranch({owner: org, repo, branch});
  // console.log(`branchInfo: ${JSON.stringify(branchInfo)}`)

  const content = await octo.repos.getContents({ owner: org, repo, path: 'a.txt', ref: branch })
  console.log(`content: ${JSON.stringify(content)}`)
  console.log(`content.data.download_url: ${content.data.download_url}`)


  const file = fs.createWriteStream("a.txt");
  const request = https.get(content.data.download_url, function(response) {
    response.pipe(file);
  });


  // repoInfo: {
  //   "status":200,
  //   "url":"https://api.github.com/repos/k-nuth/conan-packages",
  //   "headers":{
  //       "access-control-allow-origin":"*",
  //       "access-control-expose-headers":"ETag, Link, Location, Retry-After, X-GitHub-OTP, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource, X-RateLimit-Reset, X-OAuth-Scopes, X-Accepted-OAuth-Scopes, X-Poll-Interval, X-GitHub-Media-Type, X-GitHub-SSO, X-GitHub-Request-Id, Deprecation, Sunset",
  //       "cache-control":"private, max-age=60, s-maxage=60",
  //       "connection":"close",
  //       "content-encoding":"gzip",
  //       "content-security-policy":"default-src 'none'",
  //       "content-type":"application/json; charset=utf-8",
  //       "date":"Tue, 21 Mar 2023 19:38:47 GMT",
  //       "etag":"W/\"5a89d32ba29a411056119c485f72d0d2bb26839bbbfb45e8392b25e690b4ed18\"",
  //       "github-authentication-token-expiration":"2023-04-20 16:13:57 UTC",
  //       "last-modified":"Tue, 21 Mar 2023 18:28:35 GMT",
  //       "referrer-policy":"origin-when-cross-origin, strict-origin-when-cross-origin",
  //       "server":"GitHub.com",
  //       "strict-transport-security":"max-age=31536000; includeSubdomains; preload",
  //       "transfer-encoding":"chunked",
  //       "vary":"Accept, Authorization, Cookie, X-GitHub-OTP, Accept-Encoding, Accept, X-Requested-With",
  //       "x-accepted-oauth-scopes":"repo",
  //       "x-content-type-options":"nosniff",
  //       "x-frame-options":"deny",
  //       "x-github-api-version-selected":"2022-11-28",
  //       "x-github-media-type":"github.v3; format=json",
  //       "x-github-request-id":"B4EA:CFF2:9830FF8:9A9FD05:641A07C7",
  //       "x-oauth-scopes":"repo, write:packages",
  //       "x-ratelimit-limit":"5000",
  //       "x-ratelimit-remaining":"4999",
  //       "x-ratelimit-reset":"1679431127",
  //       "x-ratelimit-resource":"core",
  //       "x-ratelimit-used":"1",
  //       "x-xss-protection":"0"},
  //       "data":{"id":617118407,
  //       "node_id":"R_kgDOJMh6xw",
  //       "name":"conan-packages",
  //       "full_name":"k-nuth/conan-packages",
  //       "private":false,
  //       "owner":{"login":"k-nuth",
  //         "id":50923978,
  //         "node_id":"MDEyOk9yZ2FuaXphdGlvbjUwOTIzOTc4",
  //         "avatar_url":"https://avatars.githubusercontent.com/u/50923978?v=4",
  //         "gravatar_id":"",
  //         "url":"https://api.github.com/users/k-nuth",
  //         "html_url":"https://github.com/k-nuth",
  //         "followers_url":"https://api.github.com/users/k-nuth/followers",
  //         "following_url":"https://api.github.com/users/k-nuth/following{/other_user}",
  //         "gists_url":"https://api.github.com/users/k-nuth/gists{/gist_id}",
  //         "starred_url":"https://api.github.com/users/k-nuth/starred{/owner}{/repo}",
  //         "subscriptions_url":"https://api.github.com/users/k-nuth/subscriptions",
  //         "organizations_url":"https://api.github.com/users/k-nuth/orgs",
  //         "repos_url":"https://api.github.com/users/k-nuth/repos",
  //         "events_url":"https://api.github.com/users/k-nuth/events{/privacy}",
  //         "received_events_url":"https://api.github.com/users/k-nuth/received_events",
  //         "type":"Organization",
  //         "site_admin":false},
  //         "html_url":"https://github.com/k-nuth/conan-packages",
  //         "description":null,
  //         "fork":false,
  //         "url":"https://api.github.com/repos/k-nuth/conan-packages",
  //         "forks_url":"https://api.github.com/repos/k-nuth/conan-packages/forks",
  //         "keys_url":"https://api.github.com/repos/k-nuth/conan-packages/keys{/key_id}",
  //         "collaborators_url":"https://api.github.com/repos/k-nuth/conan-packages/collaborators{/collaborator}",
  //         "teams_url":"https://api.github.com/repos/k-nuth/conan-packages/teams",
  //         "hooks_url":"https://api.github.com/repos/k-nuth/conan-packages/hooks",
  //         "issue_events_url":"https://api.github.com/repos/k-nuth/conan-packages/issues/events{/number}",
  //         "events_url":"https://api.github.com/repos/k-nuth/conan-packages/events",
  //         "assignees_url":"https://api.github.com/repos/k-nuth/conan-packages/assignees{/user}",
  //         "branches_url":"https://api.github.com/repos/k-nuth/conan-packages/branches{/branch}",
  //         "tags_url":"https://api.github.com/repos/k-nuth/conan-packages/tags",
  //         "blobs_url":"https://api.github.com/repos/k-nuth/conan-packages/git/blobs{/sha}",
  //         "git_tags_url":"https://api.github.com/repos/k-nuth/conan-packages/git/tags{/sha}",
  //         "git_refs_url":"https://api.github.com/repos/k-nuth/conan-packages/git/refs{/sha}",
  //         "trees_url":"https://api.github.com/repos/k-nuth/conan-packages/git/trees{/sha}",
  //         "statuses_url":"https://api.github.com/repos/k-nuth/conan-packages/statuses/{sha}",
  //         "languages_url":"https://api.github.com/repos/k-nuth/conan-packages/languages",
  //         "stargazers_url":"https://api.github.com/repos/k-nuth/conan-packages/stargazers",
  //         "contributors_url":"https://api.github.com/repos/k-nuth/conan-packages/contributors",
  //         "subscribers_url":"https://api.github.com/repos/k-nuth/conan-packages/subscribers",
  //         "subscription_url":"https://api.github.com/repos/k-nuth/conan-packages/subscription",
  //         "commits_url":"https://api.github.com/repos/k-nuth/conan-packages/commits{/sha}",
  //         "git_commits_url":"https://api.github.com/repos/k-nuth/conan-packages/git/commits{/sha}",
  //         "comments_url":"https://api.github.com/repos/k-nuth/conan-packages/comments{/number}",
  //         "issue_comment_url":"https://api.github.com/repos/k-nuth/conan-packages/issues/comments{/number}",
  //         "contents_url":"https://api.github.com/repos/k-nuth/conan-packages/contents/{+path}",
  //         "compare_url":"https://api.github.com/repos/k-nuth/conan-packages/compare/{base}...{head}","merges_url":"https://api.github.com/repos/k-nuth/conan-packages/merges","archive_url":"https://api.github.com/repos/k-nuth/conan-packages/{archive_format}{/ref}","downloads_url":"https://api.github.com/repos/k-nuth/conan-packages/downloads","issues_url":"https://api.github.com/repos/k-nuth/conan-packages/issues{/number}","pulls_url":"https://api.github.com/repos/k-nuth/conan-packages/pulls{/number}","milestones_url":"https://api.github.com/repos/k-nuth/conan-packages/milestones{/number}","notifications_url":"https://api.github.com/repos/k-nuth/conan-packages/notifications{?since,all,participating}","labels_url":"https://api.github.com/repos/k-nuth/conan-packages/labels{/name}","releases_url":"https://api.github.com/repos/k-nuth/conan-packages/releases{/id}","deployments_url":"https://api.github.com/repos/k-nuth/conan-packages/deployments","created_at":"2023-03-21T18:28:35Z","updated_at":"2023-03-21T18:28:35Z","pushed_at":"2023-03-21T19:25:07Z","git_url":"git://github.com/k-nuth/conan-packages.git","ssh_url":"git@github.com:k-nuth/conan-packages.git","clone_url":"https://github.com/k-nuth/conan-packages.git","svn_url":"https://github.com/k-nuth/conan-packages","homepage":null,"size":2,"stargazers_count":0,"watchers_count":0,"language":null,"has_issues":true,"has_projects":true,"has_downloads":true,"has_wiki":true,"has_pages":false,"has_discussions":false,"forks_count":0,"mirror_url":null,"archived":false,"disabled":false,"open_issues_count":0,"license":null,"allow_forking":true,"is_template":false,"web_commit_signoff_required":false,"topics":[],"visibility":"public","forks":0,"open_issues":0,"watchers":0,"default_branch":"master","permissions":{"admin":true,"maintain":true,"push":true,"triage":true,"pull":true},"temp_clone_token":"","allow_squash_merge":true,"allow_merge_commit":true,"allow_rebase_merge":true,"allow_auto_merge":false,"delete_branch_on_merge":false,"allow_update_branch":false,"use_squash_pr_title_as_default":false,"squash_merge_commit_message":"COMMIT_MESSAGES","squash_merge_commit_title":"COMMIT_OR_PR_TITLE","merge_commit_message":"PR_TITLE","merge_commit_title":"MERGE_MESSAGE","organization":{"login":"k-nuth","id":50923978,"node_id":"MDEyOk9yZ2FuaXphdGlvbjUwOTIzOTc4","avatar_url":"https://avatars.githubusercontent.com/u/50923978?v=4","gravatar_id":"","url":"https://api.github.com/users/k-nuth","html_url":"https://github.com/k-nuth","followers_url":"https://api.github.com/users/k-nuth/followers","following_url":"https://api.github.com/users/k-nuth/following{/other_user}","gists_url":"https://api.github.com/users/k-nuth/gists{/gist_id}","starred_url":"https://api.github.com/users/k-nuth/starred{/owner}{/repo}","subscriptions_url":"https://api.github.com/users/k-nuth/subscriptions","organizations_url":"https://api.github.com/users/k-nuth/orgs","repos_url":"https://api.github.com/users/k-nuth/repos","events_url":"https://api.github.com/users/k-nuth/events{/privacy}","received_events_url":"https://api.github.com/users/k-nuth/received_events","type":"Organization","site_admin":false},"security_and_analysis":{"secret_scanning":{"status":"disabled"},"secret_scanning_push_protection":{"status":"disabled"}},"network_count":0,"subscribers_count":1}};


  // // gets commit's AND its tree's SHA
  // const currentCommit = await getCurrentCommit(octo, org, repo, branch)
  // const filesPaths = await globby(coursePath)
  // const filesBlobs = await Promise.all(filesPaths.map(createBlobForFile(octo, org, repo)))

  // const pathsForBlobs = filesPaths.map(fullPath => path.relative(coursePath, fullPath))

  // console.log(`currentCommit: ${JSON.stringify(currentCommit)}`)
  // console.log(`filesPaths:    ${filesPaths}`)
  // console.log(`filesBlobs:    ${filesBlobs}`)
  // console.log(`pathsForBlobs: ${pathsForBlobs}`)

  // const newTree = await createNewTree(
  //   octo,
  //   org,
  //   repo,
  //   filesBlobs,
  //   pathsForBlobs,
  //   currentCommit.treeSha
  // )
  // const commitMessage = `My commit message`


  // console.log(`newTree:       ${newTree}`)


  // const newCommit = await createNewCommit(
  //   octo,
  //   org,
  //   repo,
  //   commitMessage,
  //   newTree.sha,
  //   currentCommit.commitSha
  // )
  // await setBranchToCommit(octo, org, repo, branch, newCommit.sha)
}

const getCurrentCommit = async (
  octo: Octokit,
  org: string,
  repo: string,
  branch: string = 'master'
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
const getFileAsUTF8 = (filePath: string) => readFile(filePath, 'utf8')

const createBlobForFile = (octo: Octokit, org: string, repo: string) => async (
  filePath: string
) => {
  const content = await getFileAsUTF8(filePath)
  const blobData = await octo.git.createBlob({
    owner: org,
    repo,
    content,
    encoding: 'utf-8',
  })
  return blobData.data
}

const createNewTree = async (
  octo: Octokit,
  owner: string,
  repo: string,
  blobs: Octokit.GitCreateBlobResponse[],
  paths: string[],
  parentTreeSha: string
) => {
  // My custom config. Could be taken as parameters
  const tree = blobs.map(({ sha }, index) => ({
    path: paths[index],
    mode: `100644`,
    type: `blob`,
    sha,
  })) as Octokit.GitCreateTreeParamsTree[]
  const { data } = await octo.git.createTree({
    owner,
    repo,
    tree,
    base_tree: parentTreeSha,
  })
  return data
}

const createNewCommit = async (
  octo: Octokit,
  org: string,
  repo: string,
  message: string,
  currentTreeSha: string,
  currentCommitSha: string
) =>
  (await octo.git.createCommit({
    owner: org,
    repo,
    message,
    tree: currentTreeSha,
    parents: [currentCommitSha],
  })).data

const setBranchToCommit = (
  octo: Octokit,
  org: string,
  repo: string,
  branch: string = `master`,
  commitSha: string
) =>
  octo.git.updateRef({
    owner: org,
    repo,
    ref: `heads/${branch}`,
    sha: commitSha,
})

declare var process : {
  env: {
    PERSONAL_ACESSS_TOKEN: string
  }
}

const main = async () => {
  const ORGANIZATION = `k-nuth`
  const REPO = `conan-packages`
  const BRANCH = `master`

  // await uploadToRepo(octo, `./files-to-upload/c.dir/c.txt`, ORGANIZATION, REPO)
  // await uploadToRepo(process.env.PERSONAL_ACESSS_TOKEN, `./files-to-upload/`, ORGANIZATION, REPO, BRANCH)

  // await uploadToRepo(process.env.PERSONAL_ACESSS_TOKEN, `./files-to-upload/d.txt`, ORGANIZATION, REPO, BRANCH)
  await uploadToRepo(process.env.PERSONAL_ACESSS_TOKEN, `./files-to-upload/`, ORGANIZATION, REPO, BRANCH)
}

main()

// const createRepo = async (octo: Octokit, org: string, name: string) => {
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



