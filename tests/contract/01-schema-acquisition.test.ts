/**
 * 1. Schema acquisition.
 *
 * Everything else in this server is derived from one HTTP response. If that
 * response is not what `src/schema/loader.ts` expects — wrong content-type,
 * not JSON, no `paths`, a version the cache key cannot use — nothing
 * downstream is trustworthy, and the failure is silent in production because
 * the loader's fallbacks are deliberately quiet.
 *
 * Claims under test, from `docs/reference/netbox-schema-derivation.md`:
 *   §1.2  `?format=json` is served as `application/vnd.oai.openapi+json`.
 *   §1.3  The document is 6-13 MB.
 *   §1.4  `/api/status/` carries `netbox-version`; it can be null (#1582).
 */

import { beforeAll, it } from "vitest";

import { asRecord, asString, jsonType, preview } from "./http.js";
import { api, fetchSchema, record, type FetchedSchema } from "./harness.js";
import { check, describeContract } from "./expectations.js";

const SECTION = "1. Schema acquisition";

const MIN_PLAUSIBLE_BYTES = 500_000;
const MAX_PLAUSIBLE_BYTES = 30_000_000;

describeContract(SECTION, () => {
  let schema: FetchedSchema;

  beforeAll(async () => {
    schema = await fetchSchema();
  }, 320_000);

  it("serves /api/schema/?format=json as parseable OpenAPI", () => {
    const { facts, document, fromCache } = schema;

    check({
      section: SECTION,
      check: "GET /api/schema/?format=json is reachable",
      derived:
        "HTTP 200 carrying an OpenAPI document; the loader has no bundled fallback",
      actual: fromCache
        ? `HTTP ${facts.status} (replayed from this run's on-disk cache)`
        : `HTTP ${facts.status} ${facts.statusText} in ${facts.elapsedMs} ms`,
      verdict: facts.status === 200 ? "match" : "mismatch",
      note:
        facts.status === 200
          ? undefined
          : "Object-type discovery and every describe call are unavailable when this fails.",
    });

    check({
      section: SECTION,
      check: "schema response has an OpenAPI `paths` object",
      derived: "`isOpenApiDocument` requires a non-null `paths` object",
      actual: `paths is ${jsonType(document.paths)} with ${Object.keys(document.paths ?? {}).length} entries`,
      verdict: document.paths === undefined ? "mismatch" : "match",
    });
  });

  it("records the acquisition facts the derivation assumed", () => {
    const { facts, document, fromCache } = schema;

    const expectedType = "application/vnd.oai.openapi+json";
    record({
      section: SECTION,
      check: "schema Content-Type",
      derived: `${expectedType} (§1.2 — the loader must NOT gate on application/json)`,
      actual: fromCache ? `${facts.contentType} (from cache)` : facts.contentType,
      verdict: "info",
      note: facts.contentType.includes(expectedType)
        ? "As documented. A client that negotiates on content-type would refuse this body."
        : `This instance does not send the documented vendor type. §1.2 needs revising for it. ` +
          `The loader parses regardless, so nothing breaks — but do not add a content-type check.`,
    });

    record({
      section: SECTION,
      check: "schema Content-Encoding",
      derived: "gzip; §1.2 calls compression 'not optional at this size'",
      actual:
        facts.contentEncoding === ""
          ? "none — the body was transferred uncompressed"
          : `${facts.contentEncoding} (${facts.wireBytes} wire bytes -> ${facts.bytes} decoded)`,
      verdict: "info",
    });

    const megabytes = (facts.bytes / 1_000_000).toFixed(2);
    record({
      section: SECTION,
      check: "schema document size",
      derived: "6-13 MB from a live instance; 12.9 MB pretty-printed upstream (§1.3)",
      actual: fromCache
        ? `${facts.bytes} bytes (${megabytes} MB), recorded at fetch time`
        : `${facts.bytes} bytes (${megabytes} MB)`,
      verdict: "info",
      note:
        facts.bytes < MIN_PLAUSIBLE_BYTES || facts.bytes > MAX_PLAUSIBLE_BYTES
          ? "Outside the range §1.3 predicts. Check the buffer sizing assumptions in loader.ts."
          : undefined,
    });

    record({
      section: SECTION,
      check: "schema info.version",
      derived: "a NetBox version string, e.g. 4.6.7",
      actual: document.info?.version ?? "absent",
      verdict: "info",
    });

    record({
      section: SECTION,
      check: "schema component count",
      derived: "1043 component schemas on stock 4.6.7",
      actual: `${Object.keys(document.components?.schemas ?? {}).length} components, openapi ${document.openapi ?? "absent"}`,
      verdict: "info",
    });
  });

  it("reports what /api/status/ says about the version", async () => {
    const result = await api("/status/");
    const payload = asRecord(JSON.parse(result.body) as unknown);

    check({
      section: SECTION,
      check: "GET /api/status/ is reachable with this token",
      derived: "HTTP 200; the loader uses it for the cache key and the reported version",
      actual: `HTTP ${result.status} ${result.statusText}`,
      verdict: result.status === 200 ? "match" : "mismatch",
      note:
        result.status === 200
          ? undefined
          : "The loader degrades to hashing the 13 MB body for its cache key, so every cold " +
            "start re-fetches the schema before it can decide the cache is valid.",
    });

    const rawVersion = payload?.["netbox-version"];
    record({
      section: SECTION,
      check: "/api/status/ netbox-version",
      derived: "a version string; netbox-docker #1582 says it can be null (§1.4)",
      actual:
        rawVersion === null
          ? "null — the documented failure mode"
          : (asString(rawVersion) ?? `${jsonType(rawVersion)}: ${preview(rawVersion)}`),
      verdict: "info",
      note:
        asString(rawVersion) === undefined
          ? "Cache key falls back to sha256 of the whole document, so the schema is fetched " +
            "before the cache can be consulted on every cold start."
          : undefined,
    });

    const schemaVersion = schema.document.info?.version;
    const statusVersion = asString(rawVersion);
    record({
      section: SECTION,
      check: "/api/status/ version agrees with schema info.version",
      derived:
        "the same version; the provider prefers /api/status/ when both are present",
      actual: `status=${statusVersion ?? "null"}, info.version=${schemaVersion ?? "absent"}`,
      verdict: "info",
      note:
        statusVersion !== undefined &&
        schemaVersion !== undefined &&
        statusVersion !== schemaVersion
          ? "They disagree. Whatever netbox_discover reports as the version is the /api/status/ one."
          : undefined,
    });

    record({
      section: SECTION,
      check: "/api/status/ other fields",
      derived: "django-version, python-version, plugins, rq-workers-running (§1.4)",
      actual: preview(
        Object.fromEntries(
          Object.entries(payload ?? {}).filter(([key]) => key !== "plugins"),
        ),
        240,
      ),
      verdict: "info",
    });
  });
});
