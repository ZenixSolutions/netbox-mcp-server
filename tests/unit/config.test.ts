import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";

const base = { NETBOX_URL: "https://netbox.example.com", NETBOX_TOKEN: "abc123" };

describe("loadConfig", () => {
  it("rejects a missing URL and names the variable", () => {
    expect(() => loadConfig({ NETBOX_TOKEN: "abc123" })).toThrow(/NETBOX_URL/);
  });

  it("rejects a missing token and names the variable", () => {
    expect(() => loadConfig({ NETBOX_URL: base.NETBOX_URL })).toThrow(/NETBOX_TOKEN/);
  });

  it("treats whitespace-only values as missing", () => {
    expect(() => loadConfig({ NETBOX_URL: "   ", NETBOX_TOKEN: "abc" })).toThrow(
      /NETBOX_URL/,
    );
    expect(() => loadConfig({ NETBOX_URL: base.NETBOX_URL, NETBOX_TOKEN: "  " })).toThrow(
      /NETBOX_TOKEN/,
    );
  });

  it("never repeats the token in an error message", () => {
    // A thrown config error is the one place a token could plausibly leak into
    // a log the user pastes into an issue.
    try {
      loadConfig({ NETBOX_URL: "not a url", NETBOX_TOKEN: "s3cr3t-token" });
      expect.unreachable("expected loadConfig to throw");
    } catch (err) {
      expect(String(err)).not.toContain("s3cr3t-token");
    }
  });

  it("strips a trailing slash and a trailing /api", () => {
    expect(loadConfig({ ...base, NETBOX_URL: "https://n.example.com/" }).apiUrl).toBe(
      "https://n.example.com/api",
    );
    expect(loadConfig({ ...base, NETBOX_URL: "https://n.example.com/api" }).apiUrl).toBe(
      "https://n.example.com/api",
    );
    expect(loadConfig({ ...base, NETBOX_URL: "https://n.example.com/api/" }).apiUrl).toBe(
      "https://n.example.com/api",
    );
  });

  it("rejects a malformed URL", () => {
    expect(() => loadConfig({ ...base, NETBOX_URL: "not a url" })).toThrow(/not a valid/);
  });

  it("parses the truthy spellings of NETBOX_INSECURE", () => {
    for (const value of ["1", "true", "TRUE", "yes", "y", "on", " true "]) {
      expect(loadConfig({ ...base, NETBOX_INSECURE: value }).insecure).toBe(true);
    }
    for (const value of ["0", "false", "no", "", "off"]) {
      expect(loadConfig({ ...base, NETBOX_INSECURE: value }).insecure).toBe(false);
    }
  });

  it("defaults to verifying TLS", () => {
    expect(loadConfig(base).insecure).toBe(false);
  });
});
