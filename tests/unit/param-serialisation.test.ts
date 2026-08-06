import { describe, expect, it } from "vitest";

import { repeatParams } from "../../src/client.js";

/**
 * Found by running the eval set against the published 0.1.1 package: two
 * independent models filtered `dcim.device` by `name` and both received the
 * complete unfiltered list. One of them wrote that it "could easily lead
 * someone to misjudge which device is a match."
 *
 * Axios serialises an array as `name[]=a`. NetBox's filters expect the key
 * REPEATED — `name=a&name=b` — and NetBox silently ignores a parameter it does
 * not recognise, answering 200 with everything. So the bracketed form did not
 * error; it dropped the filter and returned a plausible wrong answer.
 *
 * The local filter-name validation cannot catch this. The caller sends `name`,
 * which is a legitimate parameter; the corruption happens afterwards, during
 * serialisation. A guard on the way in does not protect against a bug on the
 * way out.
 */
describe("repeatParams", () => {
  it("never emits the bracketed array form", () => {
    // The whole defect in one assertion.
    expect(repeatParams({ name: ["sw-core-01"] })).not.toContain("%5B%5D");
    expect(repeatParams({ name: ["sw-core-01"] })).not.toContain("[]");
  });

  it("repeats the key once per value", () => {
    expect(repeatParams({ tag: ["a", "b"] })).toBe("tag=a&tag=b");
  });

  it("emits a single-element array as a bare parameter", () => {
    // This is the case both models hit: one value, still an array.
    expect(repeatParams({ name: ["sw-core-01"] })).toBe("name=sw-core-01");
  });

  it("passes scalars through", () => {
    expect(repeatParams({ limit: 50, offset: 0 })).toBe("limit=50&offset=0");
  });

  it("encodes values that need it", () => {
    expect(repeatParams({ q: "sw core/01" })).toBe("q=sw+core%2F01");
    expect(repeatParams({ address: ["10.0.0.1/24"] })).toBe("address=10.0.0.1%2F24");
  });

  it("drops null and undefined rather than sending the words", () => {
    expect(repeatParams({ a: null, b: undefined, c: 1 })).toBe("c=1");
    expect(repeatParams({ tag: ["a", null, "b"] })).toBe("tag=a&tag=b");
  });

  it("keeps false and 0, which are meaningful filter values", () => {
    expect(repeatParams({ brief: false, offset: 0 })).toBe("brief=false&offset=0");
  });

  it("drops a value that has no scalar form rather than sending [object Object]", () => {
    // `String({})` is "[object Object]", which would reach NetBox as a filter
    // value. The same class of defect as the object titles fixed in 0.1.0.
    expect(repeatParams({ site: { id: 1 }, limit: 5 })).toBe("limit=5");
    expect(repeatParams({ tag: ["a", { nested: true }, "b"] })).toBe("tag=a&tag=b");
    expect(repeatParams({ a: {} })).not.toContain("object");
  });

  it("emits nothing for an empty array rather than an empty parameter", () => {
    // `tag=` would filter on the empty string, which is not what no-tags means.
    expect(repeatParams({ tag: [], limit: 1 })).toBe("limit=1");
  });
});
