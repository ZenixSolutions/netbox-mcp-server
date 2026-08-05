/**
 * Shared plumbing for the contract suite.
 *
 * Three responsibilities:
 *
 *  1. **Opt-in.** Without `NETBOX_URL` and `NETBOX_TOKEN` every block is
 *     skipped, loudly but not fatally. `npm test` never runs this suite at
 *     all (see `vitest.contract.config.ts`), so a developer with credentials
 *     in their shell still gets a hermetic `npm test`.
 *  2. **Safety.** `requireReadOnlyToken()` refuses to let a write probe run
 *     unless the global setup positively established that the token cannot
 *     write. The global setup aborts the whole run if it can write.
 *  3. **Recording.** `check()` writes one observation per assertion, pass or
 *     fail, so the report shows what was verified and not only what broke.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { buildRegistry, type SchemaRegistry } from "../../src/schema/registry.js";
import { isOpenApiDocument, type OpenApiDocument } from "../../src/schema/openapi.js";
import {
  appendObservation,
  type Observation,
  schemaCachePath,
  statePath,
} from "./observations.js";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  type HttpResult,
  request,
} from "./http.js";

export interface ContractEnv {
  baseUrl: string;
  apiUrl: string;
  token: string;
  insecure: boolean;
}

export const SKIP_MESSAGE =
  "netbox-mcp contract suite SKIPPED: NETBOX_URL and NETBOX_TOKEN are not both set.\n" +
  "  This suite talks to a real NetBox instance and is opt-in by design.\n" +
  "  Run it with:  NETBOX_URL=https://netbox.example.com NETBOX_TOKEN=<read-only token> npm run test:contract\n" +
  "  The token MUST have write_enabled = false. The suite aborts if it does not.";

function truthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

/** The configured instance, or undefined when the suite is not opted in. */
export function contractEnv(): ContractEnv | undefined {
  const rawUrl = (process.env["NETBOX_URL"] ?? "").trim();
  const token = (process.env["NETBOX_TOKEN"] ?? "").trim();
  if (rawUrl === "" || token === "") return undefined;
  const baseUrl = rawUrl.replace(/\/+$/, "").replace(/\/api$/i, "");
  return {
    baseUrl,
    apiUrl: `${baseUrl}/api`,
    token,
    insecure: truthy(process.env["NETBOX_INSECURE"]),
  };
}

export const CONTRACT_ENABLED = contractEnv() !== undefined;

/** The configured instance. Only call inside an enabled block. */
export function env(): ContractEnv {
  const value = contractEnv();
  if (!value) throw new Error(SKIP_MESSAGE);
  return value;
}

/* ------------------------------------------------------------------------ */
/* Requests                                                                   */
/* ------------------------------------------------------------------------ */

export interface ApiOptions {
  method?: string;
  body?: string;
  timeoutMs?: number;
  /** Omit the Authorization header entirely. */
  anonymous?: boolean;
  /** Send this token instead of the configured one. */
  token?: string;
  accept?: string;
}

/**
 * Request an `/api/...` path. `path` is appended to the API root and must
 * start with `/`.
 */
export function api(path: string, options: ApiOptions = {}): Promise<HttpResult> {
  const configured = env();
  const headers: Record<string, string> = {
    Accept: options.accept ?? "application/json",
  };
  if (options.anonymous !== true) {
    headers["Authorization"] = `Token ${options.token ?? configured.token}`;
  }
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return request(`${configured.apiUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: options.body }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    insecure: configured.insecure,
  });
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
export async function mapLimited<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const index = cursor++;
        const item = items[index];
        if (index >= items.length || item === undefined) return;
        results[index] = await fn(item, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/* ------------------------------------------------------------------------ */
/* Recording                                                                  */
/*                                                                            */
/* Nothing in this module may import `vitest`: it is loaded by                 */
/* `global-setup.ts`, which runs outside a worker and cannot reach vitest's    */
/* internal state. The assertion half lives in `expectations.ts`.             */
/* ------------------------------------------------------------------------ */

/** Record an observation without asserting on it. */
export function record(observation: Observation): void {
  appendObservation(env().baseUrl, observation);
}

/* ------------------------------------------------------------------------ */
/* Token capability                                                           */
/* ------------------------------------------------------------------------ */

export interface TokenCapability {
  /** `true` = can write, `false` = provably cannot, `undefined` = unknown. */
  writeEnabled: boolean | undefined;
  /** How it was determined, for the report. */
  source: string;
  detail: string;
}

export interface PreflightState {
  capability: TokenCapability;
  netboxVersion: string | null;
  plugins: Record<string, string>;
  probedAt: string;
}

/**
 * Establish whether this token can write, WITHOUT writing anything.
 *
 * Two independent probes:
 *
 *  1. `GET /api/users/tokens/` and match the configured key. Authoritative
 *     when the instance returns keys — but NetBox's `ALLOW_TOKEN_RETRIEVAL`
 *     defaults to off on modern versions, so this often cannot identify us.
 *  2. `OPTIONS` on a collection. DRF's `SimpleMetadata.determine_actions`
 *     re-runs the permission check for POST under a cloned request and only
 *     emits `actions.POST` when it passes. NetBox's `TokenPermissions` denies
 *     unsafe methods for a token with `write_enabled = false`, so the absence
 *     of `actions.POST` is real evidence, and it mutates nothing.
 *
 * Either probe reporting write access is enough to abort.
 */
export async function probeTokenCapability(): Promise<TokenCapability> {
  const configured = env();
  const notes: string[] = [];

  const tokens = await api("/users/tokens/?limit=200");
  if (tokens.status === 200) {
    const payload = asRecord(JSON.parse(tokens.body) as unknown);
    const results = asArray(payload?.["results"]) ?? [];
    let matched: Record<string, unknown> | undefined;
    for (const entry of results) {
      const row = asRecord(entry);
      const key = asString(row?.["key"]);
      if (key === undefined) continue;
      const sameKey =
        key === configured.token ||
        (key.length >= 6 && configured.token.endsWith(key.slice(-6)));
      if (sameKey) matched = row;
    }
    if (matched) {
      const writeEnabled = matched["write_enabled"];
      if (typeof writeEnabled === "boolean") {
        return {
          writeEnabled,
          source: "GET /api/users/tokens/",
          detail: `matched this token; write_enabled = ${String(writeEnabled)}`,
        };
      }
      notes.push("/api/users/tokens/ matched this token but omitted write_enabled");
    } else {
      notes.push(
        `/api/users/tokens/ returned ${results.length} token(s), none identifiable as this one ` +
          "(ALLOW_TOKEN_RETRIEVAL is probably off)",
      );
    }
  } else {
    notes.push(`GET /api/users/tokens/ returned HTTP ${tokens.status}`);
  }

  const options = await api("/dcim/sites/", { method: "OPTIONS" });
  if (options.status === 200) {
    const payload = asRecord(JSON.parse(options.body) as unknown);
    const actions = asRecord(payload?.["actions"]);
    if (actions) {
      const canPost = Object.prototype.hasOwnProperty.call(actions, "POST");
      return {
        writeEnabled: canPost,
        source: "OPTIONS /api/dcim/sites/",
        detail:
          `DRF metadata advertises actions [${Object.keys(actions).join(", ") || "none"}]` +
          (notes.length > 0 ? `; ${notes.join("; ")}` : ""),
      };
    }
    notes.push("OPTIONS /api/dcim/sites/ returned no `actions` object");
  } else {
    notes.push(`OPTIONS /api/dcim/sites/ returned HTTP ${options.status}`);
  }

  return {
    writeEnabled: undefined,
    source: "indeterminate",
    detail: notes.join("; "),
  };
}

export function readPreflightState(): PreflightState | undefined {
  try {
    const raw = readFileSync(statePath(env().baseUrl), "utf8");
    const parsed = asRecord(JSON.parse(raw) as unknown);
    if (!parsed) return undefined;
    return parsed as unknown as PreflightState;
  } catch {
    return undefined;
  }
}

export function writePreflightState(baseUrl: string, state: PreflightState): void {
  writeFileSync(statePath(baseUrl), JSON.stringify(state, null, 2), "utf8");
}

/**
 * Refuse to proceed unless the token was PROVEN unable to write.
 *
 * Returns a reason string when the probe is available and negative; throws
 * otherwise. Callers use the return value in the report.
 */
export function requireReadOnlyToken(): string {
  const state = readPreflightState();
  if (!state) {
    throw new Error(
      "No preflight state: the write-refusal probes will not run without a positive " +
        "read-only determination. Run the suite through `npm run test:contract` so the " +
        "global setup executes.",
    );
  }
  if (state.capability.writeEnabled === true) {
    throw new Error(
      "This token can WRITE. No write probe may run. (The global setup should already " +
        "have aborted the run.)",
    );
  }
  if (state.capability.writeEnabled === undefined) {
    throw new Error(
      "Token write capability is indeterminate: " +
        `${state.capability.detail}. Refusing to send any write request. ` +
        "Grant the token's user permission to read /api/users/tokens/, or enable " +
        "ALLOW_TOKEN_RETRIEVAL, so the suite can prove the token is read-only.",
    );
  }
  return `${state.capability.source}: ${state.capability.detail}`;
}

/* ------------------------------------------------------------------------ */
/* Schema document + derived registry                                         */
/* ------------------------------------------------------------------------ */

/** What the report needs to know about the schema fetch, minus the 13 MB body. */
export interface SchemaFacts {
  status: number;
  statusText: string;
  contentType: string;
  contentEncoding: string;
  /** Bytes on the wire, before decompression. */
  wireBytes: number;
  /** Bytes of JSON. */
  bytes: number;
  elapsedMs: number;
}

export interface FetchedSchema {
  document: OpenApiDocument;
  facts: SchemaFacts;
  fromCache: boolean;
}

function factsOf(result: HttpResult): SchemaFacts {
  return {
    status: result.status,
    statusText: result.statusText,
    contentType: result.contentType,
    contentEncoding: result.contentEncoding,
    wireBytes: result.wireBytes,
    bytes: result.bytes,
    elapsedMs: result.elapsedMs,
  };
}

/** Rebuild the cached facts without casting: a stale cache degrades, never throws. */
function factsFrom(value: unknown): SchemaFacts | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const status = asNumber(raw["status"]);
  const bytes = asNumber(raw["bytes"]);
  if (status === undefined || bytes === undefined) return undefined;
  return {
    status,
    statusText: asString(raw["statusText"]) ?? "",
    contentType: asString(raw["contentType"]) ?? "",
    contentEncoding: asString(raw["contentEncoding"]) ?? "",
    wireBytes: asNumber(raw["wireBytes"]) ?? bytes,
    bytes,
    elapsedMs: asNumber(raw["elapsedMs"]) ?? 0,
  };
}

let cachedSchema: FetchedSchema | undefined;
let cachedRegistry: SchemaRegistry | undefined;

/**
 * Fetch `/api/schema/?format=json` once per run.
 *
 * The document is 6-13 MB and NetBox regenerates it on every request
 * (netbox #6423), so it is cached on disk for the run and reused by every
 * test file. `NETBOX_CONTRACT_REFETCH=1` forces a fresh fetch.
 */
export async function fetchSchema(): Promise<FetchedSchema> {
  if (cachedSchema) return cachedSchema;
  const configured = env();
  const cachePath = schemaCachePath(configured.baseUrl);

  if (!truthy(process.env["NETBOX_CONTRACT_REFETCH"])) {
    try {
      const raw = readFileSync(cachePath, "utf8");
      const parsed = asRecord(JSON.parse(raw) as unknown);
      const document = parsed?.["document"];
      const facts = factsFrom(parsed?.["facts"]);
      if (isOpenApiDocument(document) && facts !== undefined) {
        cachedSchema = { document, facts, fromCache: true };
        return cachedSchema;
      }
    } catch {
      // No usable cache. Fetch.
    }
  }

  const result = await api("/schema/?format=json", {
    accept: "application/vnd.oai.openapi+json, application/json",
    timeoutMs: 300_000,
  });
  if (result.status !== 200) {
    throw new Error(
      `GET /api/schema/?format=json returned HTTP ${result.status} ${result.statusText}. ` +
        "Nothing in this suite can run without the instance's own schema.",
    );
  }
  const parsed: unknown = JSON.parse(result.body);
  if (!isOpenApiDocument(parsed)) {
    throw new Error(
      "GET /api/schema/?format=json parsed as JSON but has no OpenAPI `paths` object.",
    );
  }
  // Store the metadata without the body: the report needs the byte counts and
  // the content-type, not another copy of 13 MB.
  const facts = factsOf(result);
  writeFileSync(cachePath, JSON.stringify({ facts, document: parsed }), "utf8");
  cachedSchema = { document: parsed, facts, fromCache: false };
  return cachedSchema;
}

/** The registry `src/schema/registry.ts` derives from THIS instance. */
export async function derivedRegistry(): Promise<SchemaRegistry> {
  if (cachedRegistry) return cachedRegistry;
  cachedRegistry = buildRegistry((await fetchSchema()).document);
  return cachedRegistry;
}

/** Optional cap on how many object types the endpoint sweep touches. */
export function maxTypes(): number {
  const raw = process.env["NETBOX_CONTRACT_MAX_TYPES"];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
}
