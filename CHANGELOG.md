# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This project is **not yet stable**. While the version is below `1.0.0`, the tool
surface may change in a minor release, with the change noted here.

## [Unreleased]

### Added

- Engineering OS governance: RFC-003, issue and pull request templates, a
  contributor code of conduct, and CI covering typecheck, lint, format, test,
  build, a built-binary smoke test, and a secret scan.
- Test suite (Vitest) covering configuration parsing, tool-group gating, error
  formatting, response shaping, the packaged tarball's contents, and the size of
  the `tools/list` response.
- `--version`, `--check` and `--list-tools` command-line verbs, so a published
  package can be verified without a NetBox instance.
- Live contract suite in `tests/contract/`, run with `npm run test:contract`
  (issue #4). It compares what the server derives from an instance's own
  `/api/schema/` against what that instance actually does: schema acquisition,
  every derived endpoint, the pagination envelope, declared fields versus real
  objects, enum values, filter behaviour including unknown query parameters, the
  real status codes behind the error mapping, and the refusal of a create and a
  delete under a read-only token. It is opt-in — `npm test` never runs it, and
  without `NETBOX_URL`/`NETBOX_TOKEN` it skips with an explanation instead of
  failing. Every run writes `docs/reference/spec-defects.md` and prints the same
  report to the console, including the checks that passed.

- **The `netbox-modeling` skill, rewritten for the five-tool surface and moved
  into this repository** (RFC-003, Open Question 3). It previously lived as an
  account-level skill on one machine and drove the 446 tool names directly, so
  it did not degrade when the surface changed — it broke completely, and nothing
  in either artifact could have caught that, because the two were not versioned
  together. It now lives in `skills/netbox-modeling/` and is reviewed with the
  tools it calls.

  The rewrite teaches the layer discipline (`netbox_discover` →
  `netbox_describe` → `netbox_read`/`netbox_write`) and is explicit that three
  calls before a write is the design: batch discovery, describe once per type
  per task, resolve independent references together. It keeps the domain
  knowledge the schema cannot supply — the conventional build order for a real
  task, standard-practice defaults, and the playbooks for cabling, device
  intake, IPAM and bulk creation — and carries the live findings that change how
  a model should behave: take filter names from `netbox_describe` because NetBox
  silently ignores the ones it does not recognise, send the `value` of a choice
  field rather than the `{value, label}` object a GET returns, use `brief=true`
  when scanning for ids, and never assume an object-type key exists. The
  confirm-before-writing rule from the old skill is kept, and extended with the
  delete guard: `confirm` must echo the object's current `display` value, and
  the blast radius of a cascading delete is stated to the user before it runs.

  Three claims the old skill made were wrong before the rewrite and are not
  carried over: that `dcim.site` requires `status` (it defaults), that an
  interface's `mac_address` can be written as a legacy string (it has been
  read-only since 4.2 — a MAC is a `dcim.macaddress` object), and the long list
  of objects the server "cannot manage", which was true of the old surface and
  is now empty — tenants, regions, RIRs, module types, component templates,
  patch-panel ports and tags are all ordinary object types.

- `skills/README.md`, and `npm run build:skill`
  (`scripts/build-skill.mjs`), which validates a skill's frontmatter and packs
  the directory into a distributable `.skill` archive at
  `dist/skills/<name>.skill`. Dependency-free: `node:zlib` plus a minimal zip
  writer, rather than a dev dependency to produce one archive per release.

### Changed

- **The tool surface is now five tools instead of 446** (issue #3, RFC-003 D1).
  `netbox_global_search` finds an instance; `netbox_discover` finds a type;
  `netbox_describe` returns fields, enums, filters and what must exist first;
  `netbox_read` and `netbox_write` execute. Measured over a real stdio
  handshake, a `tools/list` response went from 720,863 characters (~180,000
  tokens) to 11,981 (~3,000). The old surface could not be loaded alongside any
  real workload.

  Layers 1 and 2 are derived at runtime from the connected instance's own
  OpenAPI document, so the planning layer cannot drift from the instance and
  picks up whatever plugins are installed.

  Execution is split in two so the MCP `annotations` stay honest: a single
  execute tool would have to declare itself destructive on every read.

  Neither execution tool accepts a path. `object_type` resolves through a
  registry, so there is no argument through which a caller can reach an
  arbitrary URL — a path-traversal surface closed by construction rather than
  by validation.

  `netbox_write` validates against the derived schema before the request leaves
  the process and returns the field description on failure, so a wrong call
  self-heals in one round-trip instead of bouncing off a NetBox 400. Deleting
  requires echoing the object's current `display` value: NetBox cascades
  deletes and there is no undo.

- Minimum Node.js is now 20 LTS. Node 18 reached end of life.
- Package renamed to `@zenixsolutions/netbox-mcp` and reset to `0.1.0`. Nothing
  was ever published under the previous name or version.
- The package no longer declares `main`. The entry point is an executable that
  starts a stdio server on import, so importing it was never meaningful.

### Removed

- `NETBOX_READONLY` and `NETBOX_TOOL_GROUPS`. Write access is controlled by the
  NetBox token's own permissions, which are enforced by NetBox where no tool
  argument can reach them. Client-side gates that a server chooses to honour
  were never the real boundary, and the installer's misreport of `read-only`
  showed what a false one costs.

- `scripts/install.sh`, and every instruction that referenced it (issue #12). A
  published package is launched with `npx @zenixsolutions/netbox-mcp`, which
  needs no clone, no build, and no installer. The script's remaining job was
  writing a client config block, and that was where its two most serious defects
  lived: it reported `mode: read-only` for values the server evaluates as false —
  registering all 446 tools, including 89 cascading deletes, under an affirmative
  safety claim — and it left a permanent world-readable backup containing the API
  token. `README.md` and `AGENTS.md` now document the `npx` invocation, the
  from-a-clone path for contributors, and `--check` as the way to verify a
  configuration.

### Fixed

- **Four defects found by running the contract suite against a real NetBox
  4.6.0.** Each was a rule that had been verified against a captured 4.6.7
  schema document and never against a live instance answering requests.

  - **A misspelled filter no longer returns the whole collection.** The
    derivation assumed a wrong query parameter would be rejected. NetBox
    ignores it: `?nb_mcp_contract_probe=1` came back HTTP 200 with the same
    `count` as the unfiltered collection, and nothing in the response said the
    filter had been dropped. `netbox_read` forwarded any syntactically valid
    name, so an agent asking for "the devices at site X" with a typo received
    **every device**, believed it had filtered, and would then act on that
    list. Filter names are now checked against the parameter set derived for
    that object type and an unknown one is refused before the request is sent,
    with near-misses named. The check is against the FULL derived set, not the
    list `netbox_describe` shows: that list is summarised — 120 of 158 names
    are elided for `dcim.site` — and `name__ic` is both legitimate and absent
    from it.

  - **An invalid token is no longer reported as a permissions problem.** The
    error mapping assumed 401 for a bad credential, on DRF's documented
    behaviour. The instance answered **403**, with a `detail` of
    "Invalid v2 token", which fell into the 403 branch and told the operator
    "the API token lacks permission for this object or action" — sending
    someone whose token is simply wrong to audit object permissions. 403 is now
    read from the body rather than the status: an invalid or expired credential
    names `NETBOX_TOKEN`, a permission refusal names the token's permissions
    and `write_enabled`, and a body matching neither says both are possible
    rather than guessing. The unauthenticated case — 403 with a `detail` of
    "Authentication credentials were not provided.", which is what a proxy
    stripping the header looks like, and which presents as neither a network
    error nor an obvious auth error — is now named explicitly.

  - **An upstream error page can no longer reach the model.** A 404 on an
    unknown endpoint answered `text/html`, and the body extractor returned a
    plain-string body verbatim — a whole error page, however large. Bodies are
    now collapsed to one line and truncated, and an HTML body is described
    rather than relayed.

  - **`plugins/inventory/purchases` derived as `plugins.inventory.purchas`.**
    The singularisation rule strips `-es` after any sibilant, which is right
    for `addresses` and wrong for `purchases`. The endpoint sweep passed
    because the endpoint is stored rather than reconstructed — but the key is
    what a model passes to `netbox_read`, and no user or model would guess the
    misspelling. `-ses` is now resolved by testing the candidate (`address`
    keeps its `-es` strip; `purchase` does not), and, ahead of the heuristic,
    the key is taken from the component the schema itself resolved
    (`PurchaseRequest` → `Purchase`) wherever that agrees with the slug modulo
    pluralisation. The slug is a routing convenience; the component is the
    serializer's own name for the model. No core object-type key changes:
    `users/permissions` stays `users.permission` and `dcim/devices` stays
    `dcim.device`, because `ObjectPermission` and `DeviceWithConfigContext` are
    not the URL's noun and are not trusted.

  The same run measured the schema fetch at **12.43 MB in 7,451 ms with no
  `Content-Encoding`** — transferred uncompressed. That one is not a defect on
  this side and nothing was changed for it: the loader already sends
  `Accept-Encoding: gzip, deflate` (the contract suite asked for compression
  too and was not given it), and the on-disk cache means the fetch is paid once
  per NetBox-plus-plugin version rather than once per process. The instance's
  front end is not compressing `application/vnd.oai.openapi+json`, which is
  worth fixing where it is served. Both the request header and the cache's
  "once per version" guarantee are now pinned by tests, because losing either
  quietly would make a 12 MB first tool call the normal case.

- Source maps are no longer published, cutting the installed size of every
  `npx` run.
- Documentation corrections (issue #13). Node.js was stated as `>= 18` in
  `README.md`, `AGENTS.md` and `CLAUDE.md` while `engines` requires `>= 20.11`;
  `--help` was prescribed for diagnosing configuration errors, which it cannot
  do because it returns before any configuration is read; a hand-rolled
  seven-line JSON-RPC pipe was documented for counting tools, which
  `--list-tools` now does; `--check`, `--version` and `--list-tools` were
  documented nowhere and are now documented everywhere they are needed; and
  `README.md` pointed contributors adding a tool group at `src/index.ts`, but
  registration lives in the `REGISTRARS` table in `src/server.ts`. The 15 tool
  counts were verified against the built binary and are correct as published.

[Unreleased]: https://github.com/ZenixSolutions/netbox-mcp-server/commits/main
