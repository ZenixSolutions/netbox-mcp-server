import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The changelog guard is driven as a subprocess on purpose. The exit status
 * and the `::error` annotations on stdout are the entire contract with
 * release.yml, and `scripts/` is outside every tsconfig by design — importing
 * the module would test neither the thing the workflow depends on nor the file
 * the workflow actually runs.
 */
const SCRIPT = fileURLToPath(
  new URL("../../scripts/check-changelog.mjs", import.meta.url),
);

const workspace = mkdtempSync(path.join(tmpdir(), "changelog-guard-"));
let counter = 0;

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function run(contents: string, version = "0.1.0") {
  counter += 1;
  const file = path.join(workspace, `CHANGELOG-${counter}.md`);
  writeFileSync(file, contents, "utf8");

  const result = spawnSync(process.execPath, [SCRIPT, version, file], {
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** A section that is genuinely finished, for reuse across the scoping cases. */
const RELEASED_SECTION = `## [0.1.0] - 2026-08-05

### Added

- First published release of the NetBox MCP server, covering DCIM and IPAM.
`;

const LINKS = `[Unreleased]: https://github.com/ZenixSolutions/netbox-mcp-server/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ZenixSolutions/netbox-mcp-server/releases/tag/v0.1.0
`;

describe("check-changelog: accepts a finished section", () => {
  it("passes a dated, populated, linked section", () => {
    const result = run(`# Changelog\n\n${RELEASED_SECTION}\n${LINKS}`);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).not.toContain("::error");
  });

  it("accepts the tag form of the version", () => {
    const result = run(`# Changelog\n\n${RELEASED_SECTION}\n${LINKS}`, "v0.1.0");

    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});

describe("check-changelog: scoping to the version's own section", () => {
  // This is the case a whole-file scan gets wrong. The real CHANGELOG.md has a
  // preamble saying the project is not yet stable and an [Unreleased] heading
  // above the released one; scanning the file rather than the section would
  // fail every release forever.
  const withUnreleasedAbove = `# Changelog

All notable changes to this project are documented here.

This project is **not yet stable**. While the version is below \`1.0.0\`, the
tool surface may change in a minor release. TODO items live in the issue
tracker, not here.

## [Unreleased]

### Added

- Nothing yet — describe the change here when you make one.

${RELEASED_SECTION}
${LINKS}`;

  it("passes despite an [Unreleased] section sitting above the release", () => {
    const result = run(withUnreleasedAbove);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).not.toContain("::error");
  });

  it("ignores scaffolding wording outside the version's section", () => {
    // "TODO", "Nothing yet" and "describe the change" all appear above the
    // 0.1.0 heading in the fixture. Each is rejected inside a section.
    expect(withUnreleasedAbove).toContain("TODO");
    expect(withUnreleasedAbove).toContain("describe the change");
    expect(run(withUnreleasedAbove).status).toBe(0);
  });

  it("stops at the next heading rather than borrowing the section below", () => {
    const result = run(`# Changelog

## [0.2.0] - 2026-09-01

<!-- TODO: write this -->

${RELEASED_SECTION}
${LINKS}[0.2.0]: https://github.com/ZenixSolutions/netbox-mcp-server/compare/v0.1.0...v0.2.0
`);

    // 0.1.0 is fine; the unfinished 0.2.0 section above it is not this run's
    // problem.
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});

describe("check-changelog: rejects an unfinished section", () => {
  it("rejects a missing heading for the version", () => {
    const result = run(`# Changelog

## [Unreleased]

### Added

- Everything, but never promoted to a release heading.

[Unreleased]: https://github.com/ZenixSolutions/netbox-mcp-server/commits/main
`);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("::error");
    expect(result.stdout).toContain("No changelog section for 0.1.0");
  });

  it("rejects a heading still marked Unreleased", () => {
    const result = run(`# Changelog

## [0.1.0] - Unreleased

### Added

- A real entry, under a heading nobody dated.

${LINKS}`);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("still marked Unreleased");
  });

  it("rejects an undated heading", () => {
    const result = run(`# Changelog

## [0.1.0]

### Added

- A real entry, under a heading nobody dated.

${LINKS}`);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("no release date");
  });

  it("rejects a date that is not a real calendar date", () => {
    const result = run(`# Changelog

## [0.1.0] - 2026-02-31

### Added

- A real entry, under a heading with an impossible date.

${LINKS}`);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("not a valid ISO date");
  });

  it("rejects an empty section", () => {
    const result = run(`# Changelog

## [0.1.0] - 2026-08-05

${LINKS}`);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("no entries");
  });

  it("rejects a section containing only a comment", () => {
    const result = run(`# Changelog

## [0.1.0] - 2026-08-05

### Added

<!-- add entries here -->

${LINKS}`);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("no entries");
  });

  it("rejects a missing comparison link", () => {
    const result = run(`# Changelog

## [0.1.0] - 2026-08-05

### Added

- A real entry that nobody linked.
`);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("No comparison link for 0.1.0");
  });

  it("rejects a comparison link that is not a URL", () => {
    const result = run(`# Changelog

## [0.1.0] - 2026-08-05

### Added

- A real entry, linked to a placeholder.

[0.1.0]: TBD
`);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("is not a URL");
  });

  it("rejects leftover scaffolding wording inside the section", () => {
    const result = run(`# Changelog

## [0.1.0] - 2026-08-05

### Added

- TODO: describe the change

${LINKS}`);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("scaffolding wording");
  });

  it("reports every failure in one run rather than the first", () => {
    const result = run(`# Changelog

## [0.1.0]

### Added

- TBD

`);

    // Undated heading, scaffolding wording, and no comparison link. Reporting
    // one at a time turns a release into three round trips.
    const annotations = result.stdout
      .split("\n")
      .filter((line) => line.startsWith("::error file="));
    expect(annotations.length).toBeGreaterThanOrEqual(3);
  });

  it("does not match a prerelease heading for the release version", () => {
    const result = run(`# Changelog

## [0.1.0-beta.1] - 2026-08-05

### Added

- A beta that is not the release being tagged.

[0.1.0-beta.1]: https://github.com/ZenixSolutions/netbox-mcp-server/releases/tag/v0.1.0-beta.1
`);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("No changelog section for 0.1.0");
  });
});

describe("check-changelog: usage", () => {
  it("exits non-zero when no version is given", () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("usage:");
  });

  it("exits non-zero when the file cannot be read", () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "0.1.0", path.join(workspace, "does-not-exist.md")],
      { encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Could not read");
  });

  it("defaults to the repository CHANGELOG.md when no path is given", () => {
    // No assertion on the verdict — the repo's own changelog changes with
    // every release. What is pinned is that the default path resolves and the
    // script produces a decision rather than a crash.
    const result = spawnSync(process.execPath, [SCRIPT, "0.1.0"], {
      encoding: "utf8",
    });

    expect([0, 1]).toContain(result.status);
    expect(result.stderr).toBe("");
  });
});
