import { describe, expect, it } from "vitest";

import { listTools } from "../../src/server.js";

/**
 * The context cost of `tools/list` is a hard constraint, not a preference. A
 * client pays it before the user has said anything, so it is subtracted from
 * every conversation the server takes part in.
 *
 * These ceilings record the surface as it stands today so that it cannot grow
 * unnoticed. They are NOT the target. RFC-003 D1 replaces the
 * one-tool-per-operation surface with five layered tools; when issue #3 lands,
 * these numbers drop to roughly 5 tools and 15,000 characters, and this test is
 * what proves it.
 */
const CEILING_TOOLS = 460;
const CEILING_CHARS = 760_000;

const CEILING_TOOLS_READONLY = 190;
const CEILING_CHARS_READONLY = 350_000;

function payloadSize(tools: unknown): number {
  return JSON.stringify(tools).length;
}

describe("tool surface", () => {
  it("registers tools and stays under the recorded ceiling", async () => {
    const tools = await listTools({});
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.length).toBeLessThanOrEqual(CEILING_TOOLS);
    expect(payloadSize(tools)).toBeLessThanOrEqual(CEILING_CHARS);
  });

  it("is materially smaller in read-only mode", async () => {
    const full = await listTools({});
    const readonly = await listTools({ NETBOX_READONLY: "1" });

    expect(readonly.length).toBeLessThan(full.length);
    expect(readonly.length).toBeLessThanOrEqual(CEILING_TOOLS_READONLY);
    expect(payloadSize(readonly)).toBeLessThanOrEqual(CEILING_CHARS_READONLY);
  });

  it("registers no write tool in read-only mode", async () => {
    const tools = await listTools({ NETBOX_READONLY: "1" });
    const writes = tools.filter((t) => /^netbox_(create|update|delete)_/.test(t.name));
    expect(writes).toEqual([]);
  });

  it("omits deletes unless the group is named", async () => {
    const tools = await listTools({ NETBOX_TOOL_GROUPS: "dcim,ipam" });
    expect(tools.filter((t) => t.name.startsWith("netbox_delete_"))).toEqual([]);
  });

  it("gives every tool a unique name and a non-empty description", async () => {
    const tools = await listTools({});
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of tools) {
      expect(tool.description ?? "", `${tool.name} has no description`).not.toBe("");
    }
  });

  it("namespaces every tool under netbox_", async () => {
    const tools = await listTools({});
    const stray = tools.filter((t) => !t.name.startsWith("netbox_"));
    expect(stray.map((t) => t.name)).toEqual([]);
  });
});
