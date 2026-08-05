/**
 * The suite's output channel.
 *
 * Every check — passing, failing or inconclusive — appends one JSON line to a
 * file in the OS temp directory. The global teardown reads them back in the
 * main process and renders `docs/reference/spec-defects.md` plus a pasteable
 * console block.
 *
 * A file rather than module state because test files run in their own module
 * registry and the teardown runs in a different context again; a file is the
 * only thing all three reliably share.
 */

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Verdict =
  /** Reality matched what the derivation assumes. */
  | "match"
  /** Reality contradicted the derivation. This is a defect. */
  | "mismatch"
  /** Recorded for the operator; there is no derived expectation to compare. */
  | "info"
  /** Could not be checked on this instance (no data, endpoint absent, …). */
  | "unverified";

export interface Observation {
  /** Report section, e.g. `2. Registry vs reality`. */
  section: string;
  /** What was checked, in one line. */
  check: string;
  /** What this codebase assumes — the derived expectation. */
  derived: string;
  /** What the instance actually did. */
  actual: string;
  verdict: Verdict;
  /** Why it matters, or what to do about it. */
  note?: string | undefined;
}

/** A stable per-instance directory, computed identically in every process. */
export function stateDir(baseUrl: string): string {
  const tag = createHash("sha256").update(baseUrl).digest("hex").slice(0, 12);
  return join(tmpdir(), "netbox-mcp-contract", tag);
}

export function observationsPath(baseUrl: string): string {
  return join(stateDir(baseUrl), "observations.jsonl");
}

export function statePath(baseUrl: string): string {
  return join(stateDir(baseUrl), "state.json");
}

export function schemaCachePath(baseUrl: string): string {
  return join(stateDir(baseUrl), "schema.json");
}

export function resetObservations(baseUrl: string): void {
  mkdirSync(stateDir(baseUrl), { recursive: true });
  rmSync(observationsPath(baseUrl), { force: true });
  writeFileSync(observationsPath(baseUrl), "", "utf8");
}

export function appendObservation(baseUrl: string, observation: Observation): void {
  mkdirSync(stateDir(baseUrl), { recursive: true });
  appendFileSync(observationsPath(baseUrl), `${JSON.stringify(observation)}\n`, "utf8");
}

export function readObservations(baseUrl: string): Observation[] {
  let raw: string;
  try {
    raw = readFileSync(observationsPath(baseUrl), "utf8");
  } catch {
    return [];
  }
  const out: Observation[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === "object" && parsed !== null) {
      out.push(parsed as Observation);
    }
  }
  return out;
}
