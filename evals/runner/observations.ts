/**
 * The eval set's output channel.
 *
 * Same shape as the contract suite's for the same reason: the test worker and
 * the teardown that renders the report run in different contexts, and a file
 * is the only thing they reliably share. One JSON line per task run, written
 * whether the task passed, failed or could not be verified.
 *
 * The recorded form is flattened deliberately — a task's `steps` carry
 * closures, and a report must be readable years after the closures have
 * changed.
 */

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StepOutcome, TaskRun, ToolName, Verdict } from "../types.js";

export interface RecordedCall {
  index: number;
  tool: ToolName;
  args: Record<string, unknown>;
  simulated: boolean;
  isError: boolean;
  /** First non-empty line of the response, for the transcript. */
  head: string;
  /** Full length of the response text, in characters. */
  responseChars: number;
  elapsedMs: number;
}

export interface RecordedRun {
  id: string;
  title: string;
  request: string;
  probes: string;
  failureMode: string;
  expectedSequence: string;
  successCondition: string;
  judgement: string;
  plausibleWrongPath: string;
  roundTripBudget: number;
  verdict: Verdict;
  detail: string;
  firstWrongStep: number | undefined;
  roundTrips: number;
  executedCalls: number;
  simulatedCalls: number;
  elapsedMs: number;
  calls: RecordedCall[];
  steps: StepOutcome[];
}

export function toRecord(run: TaskRun): RecordedRun {
  return {
    id: run.task.id,
    title: run.task.title,
    request: run.task.request,
    probes: run.task.probes,
    failureMode: run.task.failureMode,
    expectedSequence: run.task.expectedSequence,
    successCondition: run.task.successCondition,
    judgement: run.task.judgement,
    plausibleWrongPath: run.task.plausibleWrongPath,
    roundTripBudget: run.task.roundTripBudget,
    verdict: run.verdict,
    detail: run.detail,
    firstWrongStep: run.firstWrongStep,
    roundTrips: run.roundTrips,
    executedCalls: run.executedCalls,
    simulatedCalls: run.simulatedCalls,
    elapsedMs: run.elapsedMs,
    calls: run.calls.map((call) => ({
      index: call.index,
      tool: call.tool,
      args: call.args,
      simulated: call.simulated,
      isError: call.isError,
      head: (call.text.split("\n").find((line) => line.trim().length > 0) ?? "").slice(
        0,
        220,
      ),
      responseChars: call.text.length,
      elapsedMs: call.elapsedMs,
    })),
    steps: run.steps,
  };
}

/** A stable per-instance directory, computed identically in every process. */
export function stateDir(baseUrl: string): string {
  const tag = createHash("sha256").update(baseUrl).digest("hex").slice(0, 12);
  return join(tmpdir(), "netbox-mcp-eval", tag);
}

export function runsPath(baseUrl: string): string {
  return join(stateDir(baseUrl), "runs.jsonl");
}

export function statePath(baseUrl: string): string {
  return join(stateDir(baseUrl), "state.json");
}

export function resetRuns(baseUrl: string): void {
  mkdirSync(stateDir(baseUrl), { recursive: true });
  rmSync(runsPath(baseUrl), { force: true });
  writeFileSync(runsPath(baseUrl), "", "utf8");
}

export function appendRun(baseUrl: string, run: RecordedRun): void {
  mkdirSync(stateDir(baseUrl), { recursive: true });
  appendFileSync(runsPath(baseUrl), `${JSON.stringify(run)}\n`, "utf8");
}

export function readRuns(baseUrl: string): RecordedRun[] {
  let raw: string;
  try {
    raw = readFileSync(runsPath(baseUrl), "utf8");
  } catch {
    return [];
  }
  const runs: RecordedRun[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === "object" && parsed !== null) {
      runs.push(parsed as RecordedRun);
    }
  }
  return runs;
}

export interface EvalPreflight {
  netboxVersion: string | null;
  tokenCapability: string;
  writesAllowed: boolean;
  probedAt: string;
}

export function writePreflight(baseUrl: string, state: EvalPreflight): void {
  mkdirSync(stateDir(baseUrl), { recursive: true });
  writeFileSync(statePath(baseUrl), JSON.stringify(state, null, 2), "utf8");
}

export function readPreflight(baseUrl: string): EvalPreflight | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath(baseUrl), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return parsed as EvalPreflight;
  } catch {
    return undefined;
  }
}
