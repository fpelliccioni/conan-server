# conan-server

Git-backed Conan 2 remote. Configure `OWNER`, `REPO`, `BRANCH` and
`GIT_REPO_DIR` in `.env`; `PORT` defaults to 8081. Optional `HOST` restricts
the listening address (for example, `127.0.0.1` for an isolated instance).

## Remove binaries while retaining recipes and sources

Authenticate with a GitHub token that has push access to the configured data
repository, using the same Conan remote credentials as uploads. Preview first:

```sh
conan remove 'example/1.0.0#*:*' -r kth --dry-run
conan remove 'example/1.0.0#*:*' -r kth --confirm
```

The colon selects binary packages. Keep it: removing the recipe is a different
operation and is intentionally unsupported. Wildcards are expanded by the Conan
client; the server deletes only the selected package revisions. It also supports
removing every package under a specific recipe revision through the Conan API.
Recipes, exported sources, sibling versions and unrelated packages are retained.
Removing the latest package revision updates its `latest.json`; removing the last
revision removes that package ID's metadata.

Deletions and uploads use one bounded publication queue. A successful DELETE
means the commit was pushed and the read clone refreshed. Git push conflicts
fail rather than overwrite another writer; retry after inspecting the remote.
Missing binaries return 404, invalid paths 400, insufficient credentials 401/403,
and a closed or full queue 503. Reads require no credentials.

Deletion changes the current Git tree. Historical Git objects remain available;
it does not reclaim their storage or rewrite repository history.

## Validation

Run `npm ci --ignore-scripts` and `npm test` with Node.js 24. Tests use isolated
local Git repositories, including rejected pushes, credential checks, revision
metadata, recipe/source preservation and serialization with uploads. Production
continues to support Node.js 20.
