/**
 * Runs once in the main process, before and after the whole eval run.
 *
 * `setup()` establishes the ground the report stands on — NetBox version and
 * token capability, probed without writing anything — and prints, loudly, the
 * mode the run is in. A run with writes enabled says so before it does
 * anything, because the operator has to be able to stop it.
 *
 * `teardown()` renders every recorded task run into
 * `docs/reference/eval-results.md` and prints the same content to the console.
 * It runs whether tasks passed or failed: a task that could not be verified is
 * a result too.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { api, contractEnv, probeTokenCapability } from "../../tests/contract/harness.js";
import { asRecord, asString } from "../../tests/contract/http.js";
import { allowWrites, SKIP_MESSAGE } from "./harness.js";
import {
  readPreflight,
  readRuns,
  resetRuns,
  stateDir,
  writePreflight,
} from "./observations.js";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  type EvalReportMeta,
  renderConsoleBlock,
  renderMarkdown,
} from "./report.js";

const REPORT_PATH = fileURLToPath(
  new URL("../../docs/reference/eval-results.md", import.meta.url),
);

function includeHost(): boolean {
  const raw = (process.env["NETBOX_EVAL_INCLUDE_HOST"] ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(raw);
}

function instanceLabel(baseUrl: string): string {
  if (includeHost()) return baseUrl;
  const scheme = baseUrl.startsWith("https://") ? "https" : "http";
  return `${scheme}://<redacted> (set NETBOX_EVAL_INCLUDE_HOST=1 to record the host)`;
}

function modeLabel(): string {
  return allowWrites()
    ? "WRITES ENABLED (NETBOX_EVAL_ALLOW_WRITES=1) — creates are sent and cleaned up afterwards"
    : "read-only (default) — no request that changes anything is sent";
}

export async function setup(): Promise<void> {
  const configured = contractEnv();
  if (!configured) {
    console.log(`\n${SKIP_MESSAGE}\n`);
    return;
  }

  mkdirSync(stateDir(configured.baseUrl), { recursive: true });
  resetRuns(configured.baseUrl);

  const status = await api("/status/");
  let netboxVersion: string | null = null;
  if (status.status === 200) {
    netboxVersion =
      asString(asRecord(JSON.parse(status.body) as unknown)?.["netbox-version"]) ?? null;
  }

  const capability = await probeTokenCapability();

  writePreflight(configured.baseUrl, {
    netboxVersion,
    tokenCapability: `${capability.source}: ${capability.detail}`,
    writesAllowed: allowWrites(),
    probedAt: new Date().toISOString(),
  });

  console.log(
    [
      "",
      `netbox-mcp eval set: ${instanceLabel(configured.baseUrl)}`,
      `  NetBox version: ${netboxVersion ?? "unknown"}`,
      `  Token write capability: ${
        capability.writeEnabled === undefined
          ? "indeterminate"
          : capability.writeEnabled
            ? "CAN WRITE"
            : "read-only"
      } (${capability.source})`,
      `  Mode: ${modeLabel()}`,
      allowWrites()
        ? "  Objects created by a task are named `eval-probe-*` and deleted after it."
        : "  Write steps are validated against this instance's schema and recorded, not sent.",
      "",
    ].join("\n"),
  );
}

export function teardown(): void {
  const configured = contractEnv();
  if (!configured) return;

  const runs = readRuns(configured.baseUrl);
  const state = readPreflight(configured.baseUrl);
  const failed = runs.filter((run) => run.verdict === "fail").length;

  const meta: EvalReportMeta = {
    generatedAt: new Date().toISOString(),
    instance: instanceLabel(configured.baseUrl),
    netboxVersion: state?.netboxVersion ?? "unknown",
    tokenCapability: state?.tokenCapability ?? "not probed",
    mode: modeLabel(),
    outcome:
      runs.length === 0
        ? "no task ran (the run aborted before the first task, or every task was skipped)"
        : `${failed} failed across ${runs.length} task(s)`,
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, renderMarkdown(runs, meta), "utf8");

  console.log(`\n${renderConsoleBlock(runs, meta)}\n`);
  console.log(
    "Report written to docs/reference/eval-results.md — everything between\n" +
      `${BLOCK_BEGIN} and ${BLOCK_END} above is the same content.\n`,
  );
}
