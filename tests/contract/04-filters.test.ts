/**
 * 6. Filters.
 *
 * Two questions, and the second one changes how a shipped tool should behave.
 *
 * (a) Does a filter that `netbox_describe` advertises actually filter? The
 *     filter list is summarised from `paths[...].get.parameters`, and 72.5 % of
 *     the real parameters are dropped in favour of one sentence about lookup
 *     suffixes. If the surviving names do not work, that sentence is a lie.
 *
 * (b) What does NetBox do with a query parameter it does not recognise?
 *     ANSWERED, on 4.6.0: it ignores it, answers 200, and returns the
 *     UNFILTERED collection. A model's typo silently returns every object and
 *     the model believes it filtered — the worst outcome available, and NetBox
 *     gives no signal at all. `src/tools/layered/read.ts` therefore validates
 *     filter names against the derived parameter set before sending anything.
 *     This file re-establishes the premise on each run: if an instance ever
 *     turns out to be STRICT, the local rejection is redundant rather than
 *     wrong, but the premise should stop being asserted.
 */

import { beforeAll, it } from "vitest";

import { describeObjectType } from "../../src/schema/describe.js";
import type { RegistryEntry, SchemaRegistry } from "../../src/schema/registry.js";
import { asArray, asNumber, asRecord, parseJson, preview } from "./http.js";
import { api, derivedRegistry, record } from "./harness.js";
import { check, checkAll, describeContract } from "./expectations.js";
import type { Observation } from "./observations.js";

const SECTION = "6. Filters";

/** Preference order for a type to run the filter probes against. */
const CANDIDATES = [
  "dcim.site",
  "dcim.device",
  "dcim.manufacturer",
  "ipam.prefix",
  "ipam.vlan",
  "tenancy.tenant",
  "extras.tag",
];

interface Subject {
  objectType: string;
  entry: RegistryEntry;
  total: number;
  sample: Record<string, unknown>;
}

describeContract(SECTION, () => {
  let registry: SchemaRegistry;
  let subject: Subject | undefined;

  beforeAll(async () => {
    registry = await derivedRegistry();
    const keys = [
      ...CANDIDATES.filter((key) => registry.types.has(key)),
      ...[...registry.types.keys()].filter((key) => !CANDIDATES.includes(key)),
    ];
    for (const key of keys.slice(0, 40)) {
      const entry = registry.types.get(key);
      if (!entry) continue;
      const list = await api(`/${entry.summary.endpoint}/?limit=1`);
      if (list.status !== 200) continue;
      const page = asRecord(parseJson(list.body));
      const total = asNumber(page?.["count"]) ?? 0;
      const first = asRecord((asArray(page?.["results"]) ?? [])[0]);
      if (total >= 1 && first) {
        subject = { objectType: key, entry, total, sample: first };
        return;
      }
    }
  }, 300_000);

  it("filters by a name netbox_describe advertises", async () => {
    if (!subject) {
      record({
        section: SECTION,
        check: "a summarised filter actually filters",
        derived: "filtering by an advertised parameter narrows the result set",
        actual: "not checked — no sampled object type on this instance holds any objects",
        verdict: "unverified",
      });
      return;
    }

    const { objectType, entry, total, sample } = subject;
    const described = describeObjectType(registry, entry, "list");
    const advertised = new Set((described.filters ?? []).map((f) => f.name));

    record({
      section: SECTION,
      check: `${objectType} filter summarisation`,
      derived:
        "the `__`-suffixed lookup variants are elided and replaced by filterGrammar",
      actual:
        `${advertised.size} filter(s) advertised; ` +
        (described.notes[0] ?? "no elision note"),
      verdict: "info",
    });

    // Prefer a filter whose value we can read straight off a real object.
    const candidates = ["slug", "name", "id"].filter(
      (name) =>
        advertised.has(name) && sample[name] !== undefined && sample[name] !== null,
    );
    const filterName = candidates[0];
    if (filterName === undefined) {
      record({
        section: SECTION,
        check: "a summarised filter actually filters",
        derived: "slug, name or id is advertised and present on a real object",
        actual: `${objectType} offers none of slug/name/id with a usable value`,
        verdict: "unverified",
      });
      return;
    }

    const value = String(sample[filterName]);
    const filtered = await api(
      `/${entry.summary.endpoint}/?limit=5&${filterName}=${encodeURIComponent(value)}`,
    );
    const page = asRecord(parseJson(filtered.body));
    const count = asNumber(page?.["count"]);
    const results = asArray(page?.["results"]) ?? [];
    const allMatch = results.every(
      (row) => String(asRecord(row)?.[filterName]) === value,
    );

    check({
      section: SECTION,
      check: `${objectType}?${filterName}=<real value> narrows the result set`,
      derived: `fewer results than the unfiltered ${total}, and every row matching`,
      actual:
        `HTTP ${filtered.status}, count=${count ?? "absent"}, ` +
        `${results.length} row(s), all matching: ${String(allMatch)}`,
      verdict:
        filtered.status === 200 && count !== undefined && count >= 1 && allMatch
          ? "match"
          : "mismatch",
      note:
        "netbox_describe advertises this filter name; if it does not filter, the tool is " +
        "telling models to use parameters that do nothing.",
    });
  });

  it("establishes what NetBox does with an unknown query parameter", async () => {
    if (!subject) return;
    const { objectType, entry, total } = subject;
    const observations: Observation[] = [];

    const bogus = await api(
      `/${entry.summary.endpoint}/?limit=1&nb_mcp_contract_probe=1`,
    );
    const bogusPage = asRecord(parseJson(bogus.body));
    const bogusCount = asNumber(bogusPage?.["count"]);
    const ignored = bogus.status === 200 && bogusCount === total;

    observations.push({
      section: SECTION,
      check: "unknown query parameter",
      derived:
        "ignored, HTTP 200, unfiltered collection — the premise for read.ts rejecting unknown " +
        "filter names locally",
      actual:
        bogus.status === 200
          ? `HTTP 200, count=${bogusCount ?? "absent"} vs unfiltered ${total} — NetBox ${ignored ? "IGNORED it" : "changed the result set"}`
          : `HTTP ${bogus.status}: ${preview(parseJson(bogus.body), 160)}`,
      verdict: "info",
      note: ignored
        ? "NetBox is TOLERANT, as assumed. A model that misspells a filter gets the full " +
          "unfiltered collection and no indication that its filter was dropped, so read.ts " +
          "rejects unknown names itself."
        : "NetBox is STRICT about unknown parameters on this instance. read.ts's local " +
          "rejection is then redundant, not wrong — but stop asserting the tolerant premise.",
    });

    // The set read.ts validates against, on this instance's real schema: the
    // probe name must be absent from it and the real filters present, or the
    // rejection would either miss typos or refuse legitimate calls.
    const derivedNames = new Set(
      describeObjectType(registry, entry, "list").filterNames ?? [],
    );
    const advertisedNames = (
      describeObjectType(registry, entry, "list").filters ?? []
    ).map((filter) => filter.name);
    observations.push({
      section: SECTION,
      check: "the derived parameter set can catch what NetBox will not",
      derived:
        "every advertised filter is in the validated set, the `__` variants are too, and a " +
        "bogus name is not",
      actual:
        `${derivedNames.size} name(s) validated against; ` +
        `bogus name present: ${String(derivedNames.has("nb_mcp_contract_probe"))}; ` +
        `advertised names missing: ${advertisedNames.filter((name) => !derivedNames.has(name)).join(", ") || "none"}; ` +
        `lookup variants included: ${String([...derivedNames].some((name) => name.includes("__")))}`,
      verdict:
        !derivedNames.has("nb_mcp_contract_probe") &&
        advertisedNames.every((name) => derivedNames.has(name))
          ? "match"
          : "mismatch",
      note:
        "netbox_describe SUMMARISES filters; validating against the summary would reject " +
        "`name__ic`, which filterGrammar tells models to use. The validated set is the full " +
        "parameter list.",
    });

    // A known filter with a value of the wrong type.
    const badType = await api(`/${entry.summary.endpoint}/?id=not-an-integer`);
    observations.push({
      section: SECTION,
      check: "known filter, malformed value (id=not-an-integer)",
      derived: "400; errors.ts maps 400 to 'check that required fields are provided'",
      actual: `HTTP ${badType.status}: ${preview(parseJson(badType.body), 160)}`,
      verdict: badType.status === 400 ? "match" : "info",
      note:
        badType.status === 400
          ? undefined
          : "errors.ts has no branch for this status; the model gets the generic fallback.",
    });

    // A known choice filter with a value outside the enum.
    const described = describeObjectType(registry, entry, "list");
    const hasStatus = (described.filters ?? []).some((f) => f.name === "status");
    if (hasStatus) {
      const badEnum = await api(`/${entry.summary.endpoint}/?status=nb_mcp_not_a_status`);
      observations.push({
        section: SECTION,
        check: "known choice filter, value outside the enum (status=…)",
        derived: "400 with a message naming the valid choices",
        actual: `HTTP ${badEnum.status}: ${preview(parseJson(badEnum.body), 160)}`,
        verdict: "info",
      });
    }

    // MAX_LIMIT. constants.ts allows limit up to 1000; NetBox's MAX_PAGE_SIZE
    // is configurable and an instance may cap lower — in which case a model
    // asking for 1000 silently gets fewer and may conclude it saw everything.
    const wide = await api(`/${entry.summary.endpoint}/?limit=1000`);
    const widePage = asRecord(parseJson(wide.body));
    const wideCount = asNumber(widePage?.["count"]) ?? 0;
    const wideRows = (asArray(widePage?.["results"]) ?? []).length;
    observations.push({
      section: SECTION,
      check: "limit=1000 (constants.ts MAX_LIMIT)",
      derived:
        "up to 1000 rows returned; MAX_LIMIT assumes NetBox's default MAX_PAGE_SIZE",
      actual: `HTTP ${wide.status}, count=${wideCount}, ${wideRows} row(s) returned`,
      verdict: "info",
      note:
        wideRows < Math.min(wideCount, 1000)
          ? `This instance caps a page below 1000 (returned ${wideRows} of ${wideCount}). ` +
            "netbox_read's pagination maths uses the requested limit, so next_offset will " +
            "skip rows."
          : undefined,
    });

    // brief=true — describe tells models to use it.
    const brief = await api(`/${entry.summary.endpoint}/?limit=1&brief=true`);
    const briefRow = asRecord(
      (asArray(asRecord(parseJson(brief.body))?.["results"]) ?? [])[0],
    );
    observations.push({
      section: SECTION,
      check: "brief=true returns a compact object",
      derived: "describe's list note tells models 'brief=true for a compact form'",
      actual:
        brief.status === 200
          ? `HTTP 200, ${Object.keys(briefRow ?? {}).length} field(s): ${Object.keys(briefRow ?? {}).join(", ")}`
          : `HTTP ${brief.status}`,
      verdict: brief.status === 200 ? "match" : "mismatch",
    });

    record({
      section: SECTION,
      check: "filter probes ran against",
      derived: "any type holding at least one object",
      actual: `${objectType} (${total} object(s))`,
      verdict: "info",
    });

    checkAll(observations);
  });
});
