import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Build must run before test in every workflow that does both.
 *
 * `tests/installation/package-contents.test.ts` asks `npm pack` what would be
 * published, and `files` points at `dist`. Without a build the tarball is
 * documents only and that suite fails for a reason unrelated to the change
 * under test. It passes locally regardless, because a previous build leaves
 * `dist/` lying around — so the failure only exists on a clean checkout, which
 * is exactly what CI is.
 *
 * This has now been got wrong twice: once in `ci.yml`, and then again in
 * `release.yml`, which kept the wrong order after `ci.yml` was fixed and cost
 * a release run to discover. Two occurrences of the same defect in two files
 * is a class, and a class deserves a test rather than a third fix.
 */
const WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/release.yml"];

/** Step names in file order. Deliberately not a YAML parse — the order of
 *  `- name:` entries is the whole property under test, and a parser that
 *  normalises or regroups them would hide it. */
function stepNames(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => /^\s*-\s*name:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

describe.each(WORKFLOWS)("%s", (workflow) => {
  const names = stepNames(workflow);

  it("has steps at all, so a rename cannot make this test vacuous", () => {
    expect(names.length).toBeGreaterThan(3);
  });

  it("runs Build before Test", () => {
    const build = names.findIndex((n) => n === "Build");
    const test = names.findIndex((n) => n.startsWith("Test"));

    // A workflow that does neither is fine; one that does both must order them.
    if (build === -1 || test === -1) return;

    expect(
      build,
      `${workflow} runs "${names[test] ?? "Test"}" before "Build". ` +
        "The packaging suite inspects `npm pack` output, which is empty without " +
        "a build, and fails with an error that looks like a broken package.",
    ).toBeLessThan(test);
  });

  it("runs Build before any step that executes the built binary", () => {
    const build = names.findIndex((n) => n === "Build");
    const smoke = names.findIndex((n) => n.toLowerCase().includes("smoke"));
    if (build === -1 || smoke === -1) return;
    expect(build).toBeLessThan(smoke);
  });
});
