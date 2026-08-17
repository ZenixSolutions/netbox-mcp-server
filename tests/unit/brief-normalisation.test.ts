import { describe, expect, it } from "vitest";

import { normaliseBrief } from "../../src/tools/layered/read.js";

/**
 * NetBox enables brief mode for ANY non-empty value of `brief`. The check is
 * `request.GET.get('brief')` in `netbox/netbox/api/viewsets/__init__.py` — a
 * bare truthiness test on the raw string — and `'false'` and `'0'` are truthy
 * Python strings. Absence is the only "off".
 *
 * So the obvious call is inverted. A model that wants complete objects writes
 * `{ brief: false }`, and NetBox answers with the compact form: a well-formed
 * object missing most of its fields, HTTP 200, nothing anywhere saying the
 * response was truncated. A caller could then report a field as absent from
 * NetBox and be wrong about it.
 *
 * This is the same failure shape as the misspelled filter found by the live
 * contract run — the request succeeds and returns a plausible wrong answer —
 * and it is caught the same way: before the request leaves the process.
 *
 * The behaviour is a source-level reading of 4.6.8, not documented, so these
 * tests pin OUR translation rather than NetBox's parsing. If NetBox ever fixes
 * its end, dropping the parameter and sending `brief=true` both stay correct.
 */
describe("normaliseBrief", () => {
  it("drops brief=false rather than forwarding a value NetBox reads as true", () => {
    // The whole defect in one assertion: `false` must not survive as a string.
    expect(normaliseBrief({ brief: false })).toEqual({});
  });

  it("drops every other spelling of off", () => {
    for (const off of [0, "", "false", "0"] as const) {
      expect(normaliseBrief({ brief: off })).toEqual({});
    }
  });

  it("canonicalises a truthy request to brief=true", () => {
    expect(normaliseBrief({ brief: true })).toEqual({ brief: true });
    expect(normaliseBrief({ brief: "true" })).toEqual({ brief: true });
    expect(normaliseBrief({ brief: 1 })).toEqual({ brief: true });
  });

  it("leaves real boolean filters alone", () => {
    // `enabled=false` is a legitimate NetBox filter and means what it says.
    // The fix is specific to `brief`, not to booleans.
    expect(normaliseBrief({ enabled: false, brief: false })).toEqual({ enabled: false });
    expect(normaliseBrief({ enabled: false })).toEqual({ enabled: false });
  });

  it("passes through untouched when brief is absent", () => {
    const filters = { site: "dc1", status: "active" };
    expect(normaliseBrief(filters)).toBe(filters);
  });

  it("preserves the other filters when it drops brief", () => {
    expect(normaliseBrief({ site: "dc1", brief: false, q: "sw-core" })).toEqual({
      site: "dc1",
      q: "sw-core",
    });
  });
});
