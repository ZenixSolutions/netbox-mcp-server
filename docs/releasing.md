# Releasing

`.github/workflows/release.yml` publishes `@zenixsolutions/netbox-mcp` to npm when a
`v*` tag is pushed.

**Four releases have shipped: 0.1.0, 0.1.1, 0.1.2 and 0.1.3.** The first publish — the
part that cannot be automated — is done, and the trusted publisher is configured and
proven. What follows is the routine path first, then the exact configuration that makes
it work, then the things the four runs taught. Each of those cost a run, and each had a
plausible wrong explanation attached.

## Every release

```bash
# 1. Promote the [Unreleased] section in CHANGELOG.md to a dated heading and add
#    its comparison link at the foot of the file.
# 2. Bump the version in package.json.
npm run check:changelog -- 0.1.4     # must exit 0 before you tag
npm run build && npm test

git commit -am "chore(release): 0.1.4"
git tag v0.1.4
git push && git push --tags
```

The workflow then verifies the tag matches `package.json`, re-checks the changelog,
pins npm, installs, runs typecheck / lint / format check / build / test / a built-binary
smoke test, does a `npm publish --dry-run`, and publishes.

Two things it checks before installing anything, so a bad tag fails in seconds:

- **The tag matches `package.json`.** npm publishes what `package.json` says, not what
  the tag says. A mismatch would ship the wrong version under the right tag name.
- **The changelog section for that version is finished.** Grepping for the heading is
  not enough; a section still full of scaffolding satisfies a grep. `scripts/check-changelog.mjs`
  fails on a missing section, more than one section for the same version, an undated
  heading, one still marked `Unreleased`, a section with no entries, a missing or
  non-URL comparison link, or leftover scaffolding wording.

> **Stated limit.** The structural checks are exact. The scaffolding check is a phrase
> list — it only catches wording somebody thought to write down. It is a floor, not a
> substitute for reading the section before you tag.

A version number on npm **can never be reused**. If a publish ships something broken,
the only remedy is another version. That is why the dry run exists; do not remove it.

## The trusted publisher, as configured

**Trusted publishing works here and is proven.** 0.1.1, 0.1.2 and 0.1.3 all published on
the OIDC path: no `NPM_TOKEN` secret exists, nothing is passed on the command line, and
provenance is generated automatically.

The entry lives on npmjs.com under the package's Settings → Trusted publisher. These are
the values in place. They matter character by character:

| Field                | Value               |
| -------------------- | ------------------- |
| Organization or user | `ZenixSolutions`    |
| Repository           | `netbox-mcp-server` |
| Workflow filename    | `release.yml`       |
| Environment          | **blank**           |

Two of them are worth re-reading before you conclude anything else is wrong:

- The workflow field wants the **bare filename**, not `.github/workflows/release.yml`.
- The environment must be **empty**. This repository has no environments and the
  `publish` job declares none. An environment named here that the workflow does not
  declare produces a **silent no-attempt**, not a descriptive error — and a trusted
  publisher entry cannot be inspected from a runner, so nothing in a log will tell you.

## Why the workflow looks the way it does

Each of these is load-bearing. Removing one reintroduces a failure that has already cost
a release run.

**`Build` runs before `Test`.** `tests/installation/package-contents.test.ts` asks
`npm pack` what would be published, and `files` points at `dist`. With no build the
tarball is documents only and that suite fails for a reason unrelated to the change under
test. It passes locally regardless, because a previous build leaves `dist/` lying around
— so the failure exists only on a clean checkout, which is exactly what CI is. This was
fixed in `ci.yml` and `release.yml` kept the wrong order, which cost a release run to
find. Both files are now pinned by `tests/unit/workflow-step-order.test.ts`.

**The `_authToken` strip is conditional — `if: env.HAS_NPM_TOKEN != 'true'`.**
`actions/setup-node` writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into
the `.npmrc` whenever `registry-url` is set. That one line is fatal on one path and
load-bearing on the other:

- **Trusted publishing.** `NODE_AUTH_TOKEN` is unset, so npm reads an _empty_ credential,
  concludes auth is already configured, **never starts the OIDC exchange**, and sends an
  unauthenticated PUT. The registry answers the same 404 as a package that does not
  exist. The line has to go.
- **Granular token.** That same line is the only thing telling npm to use
  `NODE_AUTH_TOKEN`. The line has to stay.

Stripping it unconditionally — which this workflow did — passes every check **including
`npm publish --dry-run`, because a dry run never authenticates** — and then fails
`ENEEDAUTH` at the real publish. That is what happened on the 0.1.0 run. The condition is
pinned by `tests/unit/workflow-step-order.test.ts`.

Dropping `registry-url` instead does **not** work: with no userconfig at all npm fails
earlier with `ENEEDAUTH`, still without attempting the exchange. The registry entry has
to exist and the token line has to not
([actions/setup-node#1551](https://github.com/actions/setup-node/issues/1551)). The strip
step prints the resulting `.npmrc`; if a `_authToken` line is present in that output on a
trusted-publishing run, OIDC was never attempted and any 404 below it is a red herring.

**`secrets` is not a permitted context in a step-level `if`.** The allowed list is
`github, needs, strategy, matrix, job, runner, env, vars, steps, inputs`. Using
`secrets` there does not fail the step — it fails the whole workflow file to parse, so
the run reports _"this run likely failed because of a workflow file issue"_ with no
jobs, no steps and no logs at all. It is lifted to the job-level `env` value
`HAS_NPM_TOKEN` and compared as a string.

**The npm major is pinned to 11.** `npm install -g npm@latest` in a release job makes the
release job the first place a new npm major ever runs. npm 12 changed `npm pack --json`
from an array to an object keyed by package name, which broke the packaging test in
exactly the way that test exists to detect. (`tests/installation/package-contents.test.ts`
accepts both shapes and throws on a third.)

**`NODE_ENV: development` on `npm ci`.** `npm ci` honours `NODE_ENV`; a production value
silently omits devDependencies and every step after it fails for the wrong reason.

**`permissions: id-token: write`** is required for both provenance on the token path and
the OIDC exchange on the trusted-publishing path.

**`--provenance` is passed only on the token path.** It is generated automatically under
trusted publishing.

Trusted publishing needs npm **11.5.1+** and Node **22.14+**; the workflow pins npm 11
and Node 22.

## The first publish — kept for the next package

None of this needs doing again here. It is written down because a package's first publish
is the one part that cannot be automated, and the failure modes are unrecognisable
without it.

**Trusted publishing cannot perform a package's first publish.** A trusted publisher is
configured on a _package's settings page_, and a package that has never been published
has no settings page. npm's own documentation does not cover this case, and the failure
is a `404 ... could not be found or you do not have permission` — indistinguishable from
a permissions problem, which sends you looking in entirely the wrong place.

The workflow branches on whether an `NPM_TOKEN` secret exists, so none of this needs a
code change at any step.

1. **Publish with a granular token.** On npmjs.com create a granular access token scoped
   to the package (or the whole scope), read and write, with the shortest expiry offered.
   Add it as the repository secret `NPM_TOKEN` (Settings → Secrets and variables →
   Actions) and push the tag. The workflow takes the token path, which keeps the
   `_authToken` line and passes `--provenance` explicitly.

2. **Flip the package to public.** **This happened here, exactly as predicted.** A
   granular access token cannot set visibility on a package it is creating, so
   `--access public` is ignored and the package inherits the org default. 0.1.0 published
   successfully and then 404'd for everyone, including us, and had to be flipped by hand
   in the package's Settings → Package visibility → Public.

   "Published but private" and "never published" look identical from a browser. The org
   endpoint tells them apart, and the public registry can lag several minutes behind a
   successful publish, so it is the only thing that answers straight away:

   ```bash
   curl -s https://registry.npmjs.org/-/org/zenixsolutions/package
   ```

   - Name listed, public URL 404s → it is **private**. Flip it.
   - Name absent → it genuinely did not publish. Read the workflow log.

3. **Configure the trusted publisher.** The package now has a settings page, so the
   option now exists. Use the four values in the table above.

4. **Delete the token.** Delete the `NPM_TOKEN` repository secret, then revoke the token
   on npmjs.com. Deleting the secret alone leaves a live write-capable credential in
   existence. With the secret gone the next tag takes the trusted-publishing path
   automatically, with no change to `release.yml` — which is what 0.1.1 onwards did.

## When a publish fails

The workflow's last step runs on failure and prints guidance specific to the path the
run took. Read it — it distinguishes causes that produce an **identical 404** and have
opposite fixes.

On the trusted-publishing path, which is the one this repository is on:

1. **The trusted publisher entry does not match this workflow** → compare the four fields
   in the table above character by character.
2. **The package does not exist yet** → only possible for a new package; add an
   `NPM_TOKEN` secret and follow the first-publish sequence.

`curl -s https://registry.npmjs.org/-/org/zenixsolutions/package` tells you which one you
are in: package listed is case 1, not listed is case 2.

Nothing is ever published by a run that fails before the publish step, so no version
number is burned. The dry run is what keeps that true — but note that a green dry run
says nothing about authentication.
