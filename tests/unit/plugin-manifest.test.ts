/**
 * Guards for the Claude plugin and marketplace manifests.
 *
 * These files are never exercised by `npm test`, `npm run build` or a publish.
 * They are read by Claude Code on a user's machine, days later, from a git
 * clone of this repository — which means every way they can rot is silent
 * here and loud there:
 *
 *   - a release bumps `package.json` and forgets `plugin.json`, so installed
 *     users stay pinned to the old version and never see the new server;
 *   - the skill directory is renamed, and the plugin installs with no skill;
 *   - the npm package is renamed or scoped differently, and `npx` resolves
 *     nothing at launch;
 *   - a `${user_config.*}` reference is typo'd, and the server starts with an
 *     empty `NETBOX_URL`.
 *
 * None of those produce a failing build. They produce a failing install, for
 * someone who cannot see this repository. So they are asserted here.
 *
 * Schema references:
 *   https://code.claude.com/docs/en/plugins-reference
 *   https://code.claude.com/docs/en/plugin-marketplaces
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// `path.resolve` strips the trailing separator the URL form leaves behind, so
// the containment check below compares like with like.
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** True when `absolute` is the repository root or somewhere beneath it. */
function isInsideRepo(absolute: string): boolean {
  return absolute === repoRoot || absolute.startsWith(repoRoot + path.sep);
}

/**
 * The manifests carry only the fields this project actually uses. Unknown
 * fields are allowed through — Claude Code adds them faster than this test can
 * track — but every field named here must have the documented shape.
 */
const authorSchema = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  url: z.string().optional(),
});

const stdioServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()).optional(),
});

const userConfigFieldSchema = z.object({
  type: z.enum(["string", "number", "boolean", "directory", "file"]),
  title: z.string().min(1),
  description: z.string().min(1),
  sensitive: z.boolean().optional(),
  required: z.boolean().optional(),
});

const pluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  license: z.string().min(1),
  author: authorSchema,
  repository: z.string().min(1),
  userConfig: z.record(z.string(), userConfigFieldSchema),
  mcpServers: z.record(z.string(), stdioServerSchema),
});

const marketplaceEntrySchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  description: z.string().min(1),
  skills: z.array(z.string().min(1)),
  // Deliberately absent: see the "version lives in exactly one place" test.
  version: z.undefined(),
});

const marketplaceManifestSchema = z.object({
  name: z.string().min(1),
  owner: z.object({
    name: z.string().min(1),
    email: z.string().optional(),
    url: z.string().optional(),
  }),
  plugins: z.array(marketplaceEntrySchema).min(1),
});

const packageJsonSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});

/**
 * Narrow away an `undefined` that `noUncheckedIndexedAccess` insists on.
 *
 * Throwing here rather than asserting non-null keeps the failure legible: a
 * manifest with an empty `plugins` array names itself instead of surfacing as
 * `Cannot read properties of undefined`.
 */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is missing.`);
  return value;
}

function readJson(relative: string): unknown {
  const absolute = path.join(repoRoot, relative);
  expect(existsSync(absolute), `${relative} does not exist`).toBe(true);
  const raw = readFileSync(absolute, "utf8");
  const parse = (): unknown => JSON.parse(raw) as unknown;
  // Asserted rather than left to throw, so a syntax error names the file.
  expect(parse, `${relative} is not valid JSON`).not.toThrow();
  return parse();
}

const pluginManifest = pluginManifestSchema.parse(readJson(".claude-plugin/plugin.json"));
const marketplaceManifest = marketplaceManifestSchema.parse(
  readJson(".claude-plugin/marketplace.json"),
);
const packageJson = packageJsonSchema.parse(readJson("package.json"));

/** The one plugin this marketplace publishes. */
const entry = required(marketplaceManifest.plugins[0], "the first marketplace entry");

describe("plugin manifest", () => {
  it("lives at .claude-plugin/plugin.json, which is where Claude Code looks", () => {
    expect(existsSync(path.join(repoRoot, ".claude-plugin", "plugin.json"))).toBe(true);
    // A stray copy at the repo root is never read, and reading it as the
    // authority is exactly the mistake this catches.
    expect(existsSync(path.join(repoRoot, "plugin.json"))).toBe(false);
  });

  it("names the plugin in kebab-case", () => {
    expect(pluginManifest.name).toMatch(KEBAB_CASE);
  });

  it("declares the same version as package.json", () => {
    expect(pluginManifest.version).toBe(packageJson.version);
  });

  it("declares a version that looks like the semver a release tags", () => {
    expect(pluginManifest.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });
});

describe("marketplace manifest", () => {
  it("names the marketplace in kebab-case", () => {
    expect(marketplaceManifest.name).toMatch(KEBAB_CASE);
  });

  it("does not use a name reserved for Anthropic", () => {
    // Loading a marketplace under one of these fails as an untrusted source.
    const reserved = new Set([
      "claude-code-marketplace",
      "claude-code-plugins",
      "claude-plugins-official",
      "claude-plugins-community",
      "claude-community",
      "anthropic-marketplace",
      "anthropic-plugins",
      "agent-skills",
      "anthropic-agent-skills",
      "knowledge-work-plugins",
      "life-sciences",
      "claude-for-legal",
      "claude-for-financial-services",
      "financial-services-plugins",
      "first-party-plugins",
      "healthcare",
    ]);
    expect(reserved.has(marketplaceManifest.name)).toBe(false);
  });

  it("lists a plugin whose name matches the plugin manifest", () => {
    expect(entry.name).toBe(pluginManifest.name);
  });

  it("points at a source directory that contains a plugin manifest", () => {
    expect(entry.source.startsWith("./")).toBe(true);
    const sourceDir = path.resolve(repoRoot, entry.source);
    expect(isInsideRepo(sourceDir)).toBe(true);
    expect(statSync(sourceDir).isDirectory()).toBe(true);
    expect(existsSync(path.join(sourceDir, ".claude-plugin", "plugin.json"))).toBe(true);
  });

  it("keeps the version in exactly one place", () => {
    // Claude Code always uses plugin.json's version and never warns, so a
    // version here would be silently ignored and could go stale unnoticed.
    expect(entry.version).toBeUndefined();
  });
});

describe("bundled skill", () => {
  it("references skill directories that exist and contain a SKILL.md", () => {
    expect(entry.skills.length).toBeGreaterThan(0);
    for (const relative of entry.skills) {
      expect(relative.startsWith("./"), `${relative} must start with ./`).toBe(true);
      const skillDir = path.resolve(repoRoot, entry.source, relative);
      expect(isInsideRepo(skillDir), `${relative} escapes the repo`).toBe(true);
      expect(existsSync(skillDir), `${relative} does not exist`).toBe(true);
      expect(statSync(skillDir).isDirectory(), `${relative} is not a directory`).toBe(
        true,
      );
      expect(
        existsSync(path.join(skillDir, "SKILL.md")),
        `${relative} has no SKILL.md`,
      ).toBe(true);
    }
  });

  it("names each skill directory the same as its frontmatter name", () => {
    for (const relative of entry.skills) {
      const skillDir = path.resolve(repoRoot, entry.source, relative);
      const frontmatter = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
      const name = /^name:[ \t]*(\S+)[ \t]*$/m.exec(frontmatter)?.[1];
      expect(name, `${relative}/SKILL.md has no name in its frontmatter`).toBe(
        path.basename(skillDir),
      );
    }
  });
});

describe("bundled MCP server", () => {
  const servers = Object.entries(pluginManifest.mcpServers);
  const [serverName, server] = required(servers[0], "the first mcpServers entry");

  it("registers exactly one server", () => {
    expect(servers).toHaveLength(1);
  });

  it("keeps the name the tools are already namespaced under", () => {
    expect(serverName).toBe("netbox");
  });

  it("launches the published package through npx, not a local build", () => {
    expect(server.command).toBe("npx");
    expect(server.args).toContain("-y");
    // A path into this repository would work on the maintainer's machine and
    // nowhere else.
    for (const arg of server.args) {
      expect(arg.includes("dist/"), `${arg} points at a local build`).toBe(false);
      expect(arg.startsWith("."), `${arg} is a relative path`).toBe(false);
    }
    // ${CLAUDE_PLUGIN_ROOT} would be the same mistake spelled portably.
    expect(JSON.stringify(server)).not.toContain("CLAUDE_PLUGIN_ROOT");
  });

  it("names the package this repository publishes, pinned to its version", () => {
    const spec = required(
      server.args.find((arg) => arg.startsWith("@zenixsolutions/")),
      "an @zenixsolutions/… package spec in args",
    );

    // `@scope/name@version` — the last `@` separates the version.
    const at = spec.lastIndexOf("@");
    expect(
      at,
      `${spec} carries no @version, so the plugin cannot pin it`,
    ).toBeGreaterThan(0);

    expect(spec.slice(0, at)).toBe(packageJson.name);
    expect(spec.slice(at + 1)).toBe(packageJson.version);
  });

  it("supplies both variables the server requires", () => {
    expect(Object.keys(server.env ?? {}).sort()).toEqual(["NETBOX_TOKEN", "NETBOX_URL"]);
  });

  it("resolves every ${user_config.*} reference to a declared field", () => {
    const declared = new Set(Object.keys(pluginManifest.userConfig));
    const referenced = new Set<string>();

    for (const [, entryServer] of servers) {
      const values = [...entryServer.args, ...Object.values(entryServer.env ?? {})];
      for (const value of values) {
        for (const match of value.matchAll(/\$\{user_config\.([A-Za-z0-9_]+)\}/g)) {
          referenced.add(required(match[1], "a captured user_config key"));
        }
      }
    }

    expect(referenced.size).toBeGreaterThan(0);
    for (const key of referenced) {
      expect(declared.has(key), `\${user_config.${key}} is not declared`).toBe(true);
    }
    // The reverse direction: a declared field nothing consumes prompts the
    // user for a value that is then thrown away.
    for (const key of declared) {
      expect(referenced.has(key), `userConfig.${key} is never used`).toBe(true);
    }
  });

  it("marks the token as sensitive so it is not written to settings.json", () => {
    const token = required(
      pluginManifest.userConfig.netbox_token,
      "userConfig.netbox_token",
    );
    expect(token.sensitive).toBe(true);
    expect(token.required).toBe(true);
  });
});
