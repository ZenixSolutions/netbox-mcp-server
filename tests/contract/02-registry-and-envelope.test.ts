/**
 * 2. Registry vs reality, and 3. envelope shape.
 *
 * `src/schema/registry.ts` decides what an object type IS from path shape
 * alone: a collection with a `post` plus a matching `/{id}/` detail path. That
 * rule was verified against a committed 4.6.7 document and against nothing
 * else. This sweep asks the instance the only question that settles it — does
 * the endpoint we derived actually answer?
 *
 * A 404 on a derived endpoint is a derivation bug, and every one is reported:
 * a suite that stops at the first tells the operator to run it again N times.
 *
 * The envelope check exists because a sibling server found 22 endpoints whose
 * documented envelope was wrong. `src/client.ts` casts every list response to
 * `PaginatedResponse<T>` with no runtime check, and `src/tools/layered/read.ts`
 * reads `response.count` and `response.results` straight off it — so an
 * endpoint that answers with a bare array, or with a differently-named page
 * wrapper, produces `undefined.length` deep inside the formatter rather than
 * an error a user can act on.
 */

import { beforeAll, it } from "vitest";

import type { SchemaRegistry } from "../../src/schema/registry.js";
import { asArray, asNumber, jsonType, parseJson, preview } from "./http.js";
import { api, derivedRegistry, mapLimited, maxTypes, record } from "./harness.js";
import { check, checkAll, describeContract } from "./expectations.js";
import type { Observation } from "./observations.js";

const SECTION_REGISTRY = "2. Registry vs reality";
const SECTION_ENVELOPE = "3. List envelope shape";

const ENVELOPE_KEYS = ["count", "next", "previous", "results"] as const;
const SWEEP_CONCURRENCY = 4;

interface Probe {
  objectType: string;
  endpoint: string;
  status: number;
  body: unknown;
  elapsedMs: number;
}

describeContract(`${SECTION_REGISTRY} + ${SECTION_ENVELOPE}`, () => {
  let registry: SchemaRegistry;
  let probes: Probe[] = [];

  beforeAll(async () => {
    registry = await derivedRegistry();
    const types = [...registry.types.values()].slice(
      0,
      Math.min(registry.types.size, maxTypes()),
    );
    probes = await mapLimited(types, SWEEP_CONCURRENCY, async (entry) => {
      const result = await api(`/${entry.summary.endpoint}/?limit=1`, {
        timeoutMs: 60_000,
      });
      return {
        objectType: entry.summary.object_type,
        endpoint: entry.summary.endpoint,
        status: result.status,
        body: parseJson(result.body),
        elapsedMs: result.elapsedMs,
      };
    });
  }, 600_000);

  it("reports the derivation's own diagnostics for this instance", () => {
    const d = registry.diagnostics;

    record({
      section: SECTION_REGISTRY,
      check: "registry diagnostics",
      derived:
        "stock 4.6.7: 308 paths, 138 collections, 133 details, 126 object types, 12 excluded",
      actual:
        `${d.totalPaths} paths, ${d.collectionPaths} collections, ${d.detailPaths} details, ` +
        `${d.objectTypes} object types, ${d.excludedCollections.length} collections excluded`,
      verdict: "info",
    });

    record({
      section: SECTION_REGISTRY,
      check: "collections excluded from the registry",
      derived:
        "the 12 non-object-type collections listed in the derivation doc §2.7 — several of " +
        "them useful read-only endpoints (core/object-changes, core/jobs)",
      actual: d.excludedCollections.join(", ") || "none",
      verdict: "info",
      note: "Anything here is invisible to netbox_discover and unreachable through netbox_read.",
    });

    check({
      section: SECTION_REGISTRY,
      check: "no write schema was resolved by component name",
      derived:
        "0 — resolving by name returns the WRONG schema for dcim.site, because SiteRequest " +
        "exists as the bulk-delete payload (§3.1)",
      actual: String(d.writeSchemasResolvedByName),
      verdict: d.writeSchemasResolvedByName === 0 ? "match" : "mismatch",
    });

    const noWrite = d.typesWithoutWriteSchema;
    check({
      section: SECTION_REGISTRY,
      check: "every object type has a resolvable write schema",
      derived: "exactly one exception on stock NetBox: extras.script (§6 risk 10)",
      actual:
        noWrite.length === 0
          ? "none missing"
          : `${noWrite.length}: ${noWrite.join(", ")}`,
      verdict:
        noWrite.filter((key) => key !== "extras.script").length === 0
          ? "match"
          : "mismatch",
      note:
        "A type with no write schema cannot be described for create, so netbox_write " +
        "rejects every payload for it locally.",
    });

    const noRead = d.typesWithoutReadSchema;
    record({
      section: SECTION_REGISTRY,
      check: "object types with no resolvable read schema",
      derived: "0 on stock NetBox",
      actual: noRead.length === 0 ? "none" : `${noRead.length}: ${noRead.join(", ")}`,
      verdict: noRead.length === 0 ? "match" : "mismatch",
    });

    const noPatch = d.typesWithoutPatchSchema;
    record({
      section: SECTION_REGISTRY,
      check: "object types with no resolvable patch schema",
      derived: "0 on stock NetBox",
      actual: noPatch.length === 0 ? "none" : `${noPatch.length}: ${noPatch.join(", ")}`,
      verdict: noPatch.length === 0 ? "match" : "info",
      note:
        noPatch.length === 0
          ? undefined
          : "describe(update) silently falls back to the PUT body for these, which is a " +
            "full replacement, not a partial write.",
    });

    record({
      section: SECTION_REGISTRY,
      check: "/api/ paths classified as neither collection nor detail",
      derived:
        "37 on stock 4.6.7 — the sub-resource actions and 2-segment endpoints of §2.7",
      actual: `${d.otherPaths.length} paths`,
      verdict: "info",
    });
  });

  it("finds every derived endpoint on the instance", () => {
    const observations: Observation[] = probes.map((probe) => {
      if (probe.status === 200) {
        return {
          section: SECTION_REGISTRY,
          check: `GET /api/${probe.endpoint}/ (${probe.objectType})`,
          derived: "HTTP 200 — the registry claims this endpoint exists",
          actual: `HTTP 200 in ${probe.elapsedMs} ms`,
          verdict: "match",
        };
      }
      if (probe.status === 403 || probe.status === 401) {
        return {
          section: SECTION_REGISTRY,
          check: `GET /api/${probe.endpoint}/ (${probe.objectType})`,
          derived: "HTTP 200",
          actual: `HTTP ${probe.status} — this token may not read it`,
          verdict: "unverified",
          note: "Not a derivation bug: the endpoint exists, the token lacks object permission.",
        };
      }
      return {
        section: SECTION_REGISTRY,
        check: `GET /api/${probe.endpoint}/ (${probe.objectType})`,
        derived:
          "HTTP 200 — the registry derived this endpoint from the instance's own schema",
        actual: `HTTP ${probe.status}: ${preview(probe.body, 120)}`,
        verdict: "mismatch",
        note:
          probe.status === 404
            ? "A 404 on a derived endpoint is a derivation bug: the path rule in registry.ts " +
              "admitted a path that is not a readable collection. netbox_discover advertises " +
              `${probe.objectType} and netbox_read cannot use it.`
            : "netbox_read on this type fails with whatever handleApiError makes of this status.",
      };
    });

    record({
      section: SECTION_REGISTRY,
      check: "endpoint sweep coverage",
      derived: `${registry.types.size} derived object types`,
      actual:
        `${probes.length} probed; ` +
        `${probes.filter((p) => p.status === 200).length} OK, ` +
        `${probes.filter((p) => p.status === 404).length} not found, ` +
        `${probes.filter((p) => p.status === 401 || p.status === 403).length} forbidden, ` +
        `${probes.filter((p) => p.status >= 500).length} server errors`,
      verdict: "info",
      note:
        probes.length < registry.types.size
          ? "Capped by NETBOX_CONTRACT_MAX_TYPES; the rest are unverified."
          : undefined,
    });

    checkAll(observations);
  });

  it("returns {count, next, previous, results} on every list endpoint", () => {
    const observations: Observation[] = [];

    for (const probe of probes) {
      if (probe.status !== 200) continue;
      const label = `${probe.objectType} envelope`;
      const body = probe.body;

      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        observations.push({
          section: SECTION_ENVELOPE,
          check: label,
          derived: "an object with count, next, previous, results",
          actual: `${jsonType(body)}: ${preview(body, 120)}`,
          verdict: "mismatch",
          note:
            "client.ts casts this to PaginatedResponse<T> with no runtime check, so " +
            "read.ts reads .count and .results off it and produces a TypeError, not an error message.",
        });
        continue;
      }

      const envelope = body as Record<string, unknown>;
      const problems: string[] = [];
      if (asNumber(envelope["count"]) === undefined) {
        problems.push(`count is ${jsonType(envelope["count"])}, not a number`);
      }
      for (const key of ["next", "previous"] as const) {
        const value = envelope[key];
        if (value !== null && typeof value !== "string") {
          problems.push(`${key} is ${jsonType(value)}, not string|null`);
        }
      }
      if (asArray(envelope["results"]) === undefined) {
        problems.push(`results is ${jsonType(envelope["results"])}, not an array`);
      }
      const extras = Object.keys(envelope).filter(
        (key) => !ENVELOPE_KEYS.includes(key as (typeof ENVELOPE_KEYS)[number]),
      );

      observations.push({
        section: SECTION_ENVELOPE,
        check: label,
        derived:
          "{count: number, next: string|null, previous: string|null, results: array}",
        actual:
          problems.length > 0
            ? problems.join("; ")
            : `as expected${extras.length > 0 ? `, plus extra key(s): ${extras.join(", ")}` : ""}`,
        verdict: problems.length > 0 ? "mismatch" : "match",
        note:
          problems.length === 0 && extras.length > 0
            ? "Extra keys are harmless — PaginatedResponse<T> ignores them — but they are " +
              "instance-specific and worth knowing about."
            : undefined,
      });
    }

    checkAll(observations);
  });
});
