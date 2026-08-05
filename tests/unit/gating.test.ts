import { describe, expect, it, vi } from "vitest";

import { ALL_TOOL_GROUPS, enabledGroups, isReadOnly } from "../../src/gating.js";

describe("enabledGroups", () => {
  it("registers every group when unset", () => {
    expect(enabledGroups({}).size).toBe(ALL_TOOL_GROUPS.length);
  });

  it("registers every group when set to whitespace", () => {
    expect(enabledGroups({ NETBOX_TOOL_GROUPS: "   " }).size).toBe(
      ALL_TOOL_GROUPS.length,
    );
  });

  it("honours an allowlist and is case- and space-insensitive", () => {
    const groups = enabledGroups({ NETBOX_TOOL_GROUPS: " DCIM , ipam " });
    expect([...groups].sort()).toEqual(["dcim", "ipam"]);
  });

  it("omits deletes unless named explicitly", () => {
    expect(enabledGroups({ NETBOX_TOOL_GROUPS: "dcim,ipam" }).has("deletes")).toBe(false);
  });

  it("ignores unknown names with a warning rather than crashing", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const groups = enabledGroups({ NETBOX_TOOL_GROUPS: "dcim,nonsense" });
    expect([...groups]).toEqual(["dcim"]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("nonsense");
    warn.mockRestore();
  });

  it("falls back to every group when nothing valid was named", () => {
    // Degrading open is a deliberate choice: a typo in a client config should
    // not silently produce a server with no tools at all.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(enabledGroups({ NETBOX_TOOL_GROUPS: "nope,also-nope" }).size).toBe(
      ALL_TOOL_GROUPS.length,
    );
    warn.mockRestore();
  });
});

describe("isReadOnly", () => {
  it("is off by default", () => {
    expect(isReadOnly({})).toBe(false);
  });

  it("accepts the documented truthy spellings", () => {
    for (const value of ["1", "true", "yes", "y", "on"]) {
      expect(isReadOnly({ NETBOX_READONLY: value })).toBe(true);
    }
  });

  it("does not treat an arbitrary non-empty string as true", () => {
    expect(isReadOnly({ NETBOX_READONLY: "please" })).toBe(false);
  });
});
