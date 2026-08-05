# Releasing

`.github/workflows/release.yml` publishes `@zenixsolutions/netbox-mcp` to npm when a
`v*` tag is pushed. Most of what follows is automated. The part that is not — the
**first publish** — is written out in full, because a sibling server took six failed
runs to get through it and every failure had a plausible wrong explanation attached.

## Every release after the first

```bash
# 1. Promote the [Unreleased] section in CHANGELOG.md to a dated heading and add
#    its comparison link at the foot of the file.
# 2. Bump the version in package.json.
npm run check:changelog -- 0.1.1     # must exit 0 before you tag
npm run build && npm test

git commit -am "chore(release): 0.1.1"
git tag v0.1.1
git push && git push --tags
```

The workflow then verifies the tag matches `package.json`, re-checks the changelog,
runs the full validation suite, does a `npm publish --dry-run`, and publishes.

Two things it checks before installing anything, so a bad tag fails in seconds:

- **The tag matches `package.json`.** npm publishes what `package.json` says, not what
  the tag says. A mismatch would ship the wrong version under the right tag name.
- **The changelog section for that version is finished.** Grepping for the heading is
  not enough; a section still full of scaffolding satisfies a grep. The guard fails on
  a missing or undated heading, one still marked `Unreleased`, an empty section, a
  missing comparison link, or leftover scaffolding wording.

> **Stated limit.** The structural checks are exact. The scaffolding check is a phrase
> list — it only catches wording somebody thought to write down. It is a floor, not a
> substitute for reading the section before you tag.

A version number on npm **can never be reused**. If a publish ships something broken,
the only remedy is another version. That is why the dry run exists; do not remove it.

## The first publish — by hand, once

**Trusted publishing cannot perform a package's first publish.** A trusted publisher is
configured on a _package's settings page_, and a package that has never been published
has no settings page. npm's own documentation does not cover this case, and the failure
is a `404 ... could not be found or you do not have permission` — indistinguishable
from a permissions problem, which sends you looking in entirely the wrong place.

The workflow already branches on whether an `NPM_TOKEN` secret exists, so none of this
needs a code change. Do the four steps in order.

### 1. Publish with a granular token

On npmjs.com, create a **granular access token**:

| Field      | Value                                             |
| ---------- | ------------------------------------------------- |
| Packages   | `@zenixsolutions/netbox-mcp` (or the whole scope) |
| Permission | Read and write                                    |
| Expiry     | The shortest offered — it is deleted at step 4    |

Add it to the repository as the secret `NPM_TOKEN`
(Settings → Secrets and variables → Actions), then push the tag. The workflow takes the
token path, which passes `--provenance` explicitly.

### 2. Flip the package to public

**The package is now private, and this is not obvious.** A granular access token cannot
set visibility on a package it is creating, so `--access public` is ignored and the
package inherits the org default. The publish succeeds and then 404s for everyone,
including you.

"Published but private" and "never published" look identical from a browser. Tell them
apart with the org endpoint, which lists the packages the org owns:

```bash
curl -s https://registry.npmjs.org/-/org/zenixsolutions/package
```

- Name listed, public URL 404s → it is **private**. Flip it in the package's
  Settings → Package visibility → Public.
- Name absent → it genuinely did not publish. Read the workflow log.

Note also that the public registry can lag several minutes behind a successful publish,
so "not visible yet" and "not published" look the same for a while. The org endpoint is
the only thing that distinguishes them straight away.

### 3. Configure the trusted publisher

The package now has a settings page, so the option now exists. On the package's
Settings → Trusted publisher, add a GitHub Actions publisher:

| Field                | Value               |
| -------------------- | ------------------- |
| Organization or user | `ZenixSolutions`    |
| Repository           | `netbox-mcp-server` |
| Workflow filename    | `release.yml`       |
| Environment          | **leave empty**     |

Two fields are worth checking character by character. The workflow field wants the
**bare filename**, not `.github/workflows/release.yml`. And the environment must be
empty, because the `publish` job does not declare one — an environment set here that
the workflow does not declare produces a **silent no-attempt**, not a descriptive
error. This exact mismatch is the one thing on the sibling server that was never
resolved from CI, because a trusted publisher entry cannot be inspected from a runner.

### 4. Delete the token

Delete the `NPM_TOKEN` repository secret, then revoke the token on npmjs.com. Deleting
the secret alone leaves a live write-capable credential in existence.

With the secret gone, the next tag takes the trusted-publishing path automatically. No
change to `release.yml`.

## Why the workflow looks the way it does

Each of these is load-bearing. Removing one reintroduces a failure that has already
cost somebody a day.

**`secrets` is not a permitted context in a step-level `if`.** The allowed list is
`github, needs, strategy, matrix, job, runner, env, vars, steps, inputs`. Using
`secrets` there does not fail the step — it fails the whole workflow file to parse, so
the run reports _"this run likely failed because of a workflow file issue"_ with no
jobs, no steps and no logs at all. It is lifted to job-level `env` and compared as a
string.

**`actions/setup-node` silently disables OIDC.** With `registry-url` set it writes
`//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into the `.npmrc`. On the
trusted-publishing path that variable is unset, so npm reads an _empty_ auth token,
concludes credentials are already configured, **never starts the OIDC exchange**, and
sends an unauthenticated PUT. The registry answers with the same 404 as a
never-published package. Dropping `registry-url` instead does **not** work — with no
userconfig at all npm fails earlier with `ENEEDAUTH`, still without attempting the
exchange. The registry entry has to exist and the token line has to not, so the
workflow keeps `registry-url` and deletes the line
([actions/setup-node#1551](https://github.com/actions/setup-node/issues/1551)). The
workflow prints the resulting `.npmrc`; if a `_authToken` line is ever present in that
output, OIDC was never attempted and any 404 below it is a red herring.

**The npm major is pinned.** `npm install -g npm@latest` in a release job makes the
release job the first place a new npm major ever runs. npm 12 changed `npm pack --json`
from an array to an object keyed by package name, which broke the packaging test in
exactly the way that test exists to detect. (`tests/installation/package-contents.test.ts`
accepts both shapes and throws on a third.)

**`permissions: id-token: write`** is required for both provenance on the token path
and the OIDC exchange on the trusted-publishing path.

**`--provenance` is passed only on the token path.** It is generated automatically
under trusted publishing.

Trusted publishing needs npm **11.5.1+** and Node **22.14+**; the workflow pins npm 11
and Node 22.

## When a publish fails

The workflow's last step runs on failure and prints guidance specific to the path the
run took. Read it — it distinguishes the two causes that produce an **identical 404**
and have opposite fixes:

1. **The package does not exist yet** → add an `NPM_TOKEN` secret and follow the
   first-publish sequence above.
2. **The trusted publisher entry does not match this workflow** → compare the four
   fields in step 3 character by character.

`curl -s https://registry.npmjs.org/-/org/zenixsolutions/package` tells you which one
you are in: package not listed is case 1, listed is case 2.

Nothing is ever published by a failed run that fails before the publish step, so no
version number is burned. The dry run is what keeps that true.
