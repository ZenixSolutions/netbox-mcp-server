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
