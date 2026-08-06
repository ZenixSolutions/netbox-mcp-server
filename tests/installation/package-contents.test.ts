import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackResult {
  name?: string;
  files?: { path: string }[];
}

/**
 * `npm pack --json` changed shape in npm 12: npm 10 and 11 return an array of
 * package objects, npm 12 returns an object keyed by package name. Indexing
 * `[0]` reports zero files under npm 12 — which is exactly the failure this
 * test exists to catch, so it would fail loudly for the wrong reason.
 *
 * Accept both, and throw with the observed output if a third ever appears.
 */
function parsePackOutput(raw: string): PackResult {
  const parsed: unknown = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    const first = parsed[0] as PackResult | undefined;
    if (!first) throw new Error(`npm pack --json returned an empty array: ${raw}`);
    return first;
  }

  if (parsed && typeof parsed === "object") {
    const values = Object.values(parsed as Record<string, unknown>);
    const first = values[0] as PackResult | undefined;
    if (!first) throw new Error(`npm pack --json returned an empty object: ${raw}`);
    return first;
  }

  throw new Error(`Unrecognised npm pack --json shape: ${raw}`);
}

/**
 * Invoking npm from Node is platform-specific, and gets it wrong twice.
 *
 * On Windows npm is `npm.cmd`. `execFileSync("npm", ...)` cannot find it —
 * `.cmd` is not resolved without a shell — and fails ENOENT. Naming
 * `npm.cmd` explicitly then fails EINVAL, because since the 2024
 * command-injection hardening Node refuses to spawn a `.cmd` or `.bat` at
 * all unless a shell is requested.
 *
 * So a shell is required on Windows. It is safe here for a specific reason
 * worth stating: every argument below is a literal constant. Nothing from a
 * test fixture, the environment or the filesystem reaches the command line,
 * which is the condition that makes `shell: true` a quoting question rather
 * than an injection one.
 */
const IS_WINDOWS = process.platform === "win32";

describe("published package contents", () => {
  const result = parsePackOutput(
    execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: IS_WINDOWS,
    }),
  );
  const paths = (result.files ?? []).map((f) => f.path);

  it("packs something at all", () => {
    // Guards the direction that silently ships a broken package: a `files`
    // entry that matches nothing still publishes successfully.
    expect(paths.length).toBeGreaterThan(0);
  });

  it("ships the built entry point", () => {
    // `files` points at `dist`, so this suite is meaningless without a build.
    // Say that plainly: the bare assertion reads as "the package is broken"
    // when the real cause is that `npm run build` has not run yet. CI ordered
    // test before build and lost twenty minutes to exactly that.
    expect(
      existsSync("dist/index.js"),
      "dist/index.js does not exist — run `npm run build` before this suite. " +
        "`npm pack` can only report what the working tree actually contains.",
    ).toBe(true);
    expect(paths).toContain("dist/index.js");
  });

  it("ships the documents a consumer needs", () => {
    for (const required of ["README.md", "LICENSE", "CHANGELOG.md"]) {
      expect(paths, `${required} missing from the tarball`).toContain(required);
    }
  });

  it("does not ship source maps", () => {
    // ~23% of the install size on the sibling server, for files whose sources
    // are not published anyway.
    expect(paths.filter((p) => p.endsWith(".map"))).toEqual([]);
  });

  it("does not ship tests, sources or configuration", () => {
    const leaked = paths.filter(
      (p) =>
        p.startsWith("tests/") ||
        p.startsWith("src/") ||
        p.startsWith(".github/") ||
        p === "tsconfig.json" ||
        p === "eslint.config.js",
    );
    expect(leaked).toEqual([]);
  });

  it("never ships a real environment file", () => {
    const dotenv = paths.filter((p) => p.startsWith(".env") && p !== ".env.example");
    expect(dotenv).toEqual([]);
  });
});
