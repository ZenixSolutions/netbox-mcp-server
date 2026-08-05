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

- Minimum Node.js is now 20 LTS. Node 18 reached end of life.
- Package renamed to `@zenixsolutions/netbox-mcp` and reset to `0.1.0`. Nothing
  was ever published under the previous name or version.
- The package no longer declares `main`. The entry point is an executable that
  starts a stdio server on import, so importing it was never meaningful.

### Fixed

- Source maps are no longer published, cutting the installed size of every
  `npx` run.

[Unreleased]: https://github.com/ZenixSolutions/netbox-mcp-server/commits/main
