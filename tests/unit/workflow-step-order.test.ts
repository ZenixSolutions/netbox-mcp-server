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

/**
 * The `.npmrc` `_authToken` line is load-bearing on ONE path and fatal on the
 * other, which is why this is pinned rather than left to a comment.
 *
 * setup-node writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`.
 * Under trusted publishing that variable is unset, so npm reads an empty
 * credential, decides auth is configured, and never starts the OIDC exchange —
 * the line has to go. Under a granular token that same line is the only thing
 * telling npm to use NODE_AUTH_TOKEN — the line has to stay.
 *
 * Stripping it unconditionally passes every check including `npm publish
 * --dry-run`, because a dry run never authenticates, and then fails ENEEDAUTH
 * at the real publish. That is exactly what happened on the first v0.1.0
 * release run.
 */
describe(".github/workflows/release.yml auth paths", () => {
  const yaml = readFileSync(".github/workflows/release.yml", "utf8");

  it("strips the _authToken line only when there is no NPM_TOKEN", () => {
    const step = /- name: Strip the _authToken line[^\n]*\n([\s\S]*?)\n\s*- name:/.exec(
      yaml,
    );
    expect(step, "the strip step is gone — was it renamed?").not.toBeNull();
    expect(
      step?.[1] ?? "",
      "the strip step must be conditional. Unconditional, it deletes the line " +
        "the granular-token path depends on, and the failure appears only at " +
        "the real publish — after the dry run has passed.",
    ).toMatch(/if:\s*env\.HAS_NPM_TOKEN\s*!=\s*'true'/);
  });

  it("never reads `secrets` in a step-level if", () => {
    // A `secrets` reference in a step `if` does not fail the step — it fails
    // the whole workflow file to parse, producing a run with no jobs, no logs
    // and a message that points nowhere.
    const stepIfs = yaml.split("\n").filter((l) => /^\s+if:/.test(l));
    for (const line of stepIfs) {
      expect(line, "use a job-level env, compared as a string").not.toContain("secrets.");
    }
  });
});
