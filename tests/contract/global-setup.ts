/**
 * Runs once in the main process, before and after the whole contract run.
 *
 * `setup()` is the safety gate. It is deliberately the FIRST thing that talks
 * to the instance, and it establishes — without writing anything — whether the
 * supplied token can write. If it can, the run is aborted here, before a
 * single test file is loaded, so no write probe can ever reach a read-write
 * instance.
 *
 * `teardown()` is the output. It renders every recorded observation into
 * `docs/reference/spec-defects.md` and prints a delimited block to the
 * console, whether the run passed or failed.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  api,
  contractEnv,
  probeTokenCapability,
  readPreflightState,
  SKIP_MESSAGE,
  tokenFingerprint,
  writePreflightState,
} from "./harness.js";
import { asRecord, asString } from "./http.js";
import {
  readObservations,
  resetObservations,
  schemaCachePath,
  stateDir,
} from "./observations.js";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  renderConsoleBlock,
  renderMarkdown,
  type ReportMeta,
} from "./report.js";

const REPORT_PATH = fileURLToPath(
  new URL("../../docs/reference/spec-defects.md", import.meta.url),
);

function includeHost(): boolean {
  const raw = (process.env["NETBOX_CONTRACT_INCLUDE_HOST"] ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(raw);
}

function instanceLabel(baseUrl: string): string {
  if (includeHost()) return baseUrl;
  const scheme = baseUrl.startsWith("https://") ? "https" : "http";
  return `${scheme}://<redacted> (set NETBOX_CONTRACT_INCLUDE_HOST=1 to record the host)`;
}

export async function setup(): Promise<void> {
  const configured = contractEnv();
  if (!configured) {
    console.log(`\n${SKIP_MESSAGE}\n`);
    return;
  }

  mkdirSync(stateDir(configured.baseUrl), { recursive: true });
  resetObservations(configured.baseUrl);

  console.log(
    `\nnetbox-mcp contract suite: ${instanceLabel(configured.baseUrl)}\n` +
      "  Preflight: establishing the token's write capability WITHOUT writing anything.",
  );

  const status = await api("/status/");
  let netboxVersion: string | null = null;
  let plugins: Record<string, string> = {};
  if (status.status === 200) {
    const payload = asRecord(JSON.parse(status.body) as unknown);
    netboxVersion = asString(payload?.["netbox-version"]) ?? null;
    const rawPlugins = asRecord(payload?.["plugins"]);
    if (rawPlugins) {
      plugins = Object.fromEntries(
        Object.entries(rawPlugins).map(([name, value]) => [name, String(value)]),
      );
    }
  }

  const capability = await probeTokenCapability();

  if (capability.writeEnabled === true) {
    throw new Error(
      [
        "",
        "ABORTED: the supplied NETBOX_TOKEN has WRITE access.",
        "",
        `  Evidence: ${capability.source} — ${capability.detail}`,
        "",
        "  This suite sends deliberate write requests to observe how they are refused.",
        "  It will not do that against an instance it could actually modify.",
        "  Create a token with write_enabled = false and re-run.",
        "",
      ].join("\n"),
    );
  }

  writePreflightState(configured.baseUrl, {
    capability,
    netboxVersion,
    plugins,
    probedAt: new Date().toISOString(),
    // State is keyed by base URL only. Bind it to the token as well so a
    // determination made for one token can never be reused for another.
    tokenFingerprint: tokenFingerprint(configured.token),
  });

  console.log(
    `  Token: ${
      capability.writeEnabled === false
        ? "read-only, confirmed"
        : "capability INDETERMINATE — write-refusal probes will be skipped"
    } (${capability.source}: ${capability.detail})\n` +
      `  NetBox version from /api/status/: ${netboxVersion ?? "null"}\n` +
      `  Plugins reported: ${Object.keys(plugins).join(", ") || "none"}\n` +
      `  Schema cache: ${schemaCachePath(configured.baseUrl)}\n`,
  );
}

export function teardown(): void {
  const configured = contractEnv();
  if (!configured) return;

  const observations = readObservations(configured.baseUrl);
  const state = readPreflightState();

  const schemaInfoVersion =
    observations.find((o) => o.check === "schema info.version")?.actual ?? "not recorded";
  const meta: ReportMeta = {
    generatedAt: new Date().toISOString(),
    instance: instanceLabel(configured.baseUrl),
    netboxVersion: state?.netboxVersion ?? "null (see defects)",
    schemaInfoVersion,
    tokenCapability:
      state === undefined
        ? "not probed"
        : `${state.capability.source} — ${state.capability.detail}`,
    suiteOutcome:
      observations.length === 0
        ? "no observations recorded (the run aborted before any check, or every block was skipped)"
        : `${observations.filter((o) => o.verdict === "mismatch").length} defect(s) across ${observations.length} check(s)`,
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, renderMarkdown(observations, meta), "utf8");

  console.log(`\n${renderConsoleBlock(observations, meta)}\n`);
  console.log(
    `Report written to docs/reference/spec-defects.md — everything between\n` +
      `${BLOCK_BEGIN} and ${BLOCK_END} above is the same content, pasteable as-is.\n`,
  );
}
