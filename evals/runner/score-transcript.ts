/**
 * Mechanical scoring of a transcript produced by an actual model.
 *
 * This is the seam between what a runner can decide and what it cannot. Give
 * it the tool calls a model made for a task and it will tell you, with no
 * opinion involved:
 *
 *   - whether every tool it called exists (a model that calls
 *     `netbox_changelog` has invented a tool, which is the exact failure mode
 *     E08 exists to catch);
 *   - whether the arguments satisfy the advertised input schema;
 *   - whether it addressed object types this instance has;
 *   - how many round-trips it took, against the task's budget;
 *   - whether the reference sequence appears in what it did.
 *
 * And it will tell you, explicitly, what it is NOT deciding: whether the final
 * answer was true, whether a refusal was the right call, whether a different
 * route was better. Those need a human or an LLM judge. They are emitted as
 * `unscoreable` findings so they cannot be quietly counted as passes.
 *
 * The transcript format is deliberately trivial — `{ task_id, calls: [{ tool,
 * arguments }] }` — so it can be produced by hand, by an MCP client's log, or
 * by a harness that drives a model.
 */

import { asArray, asRecord, asString } from "../../tests/contract/http.js";
import { TOOL_NAMES, type EvalTask, type ToolName } from "../types.js";
import type { ToolArgumentSchema } from "./session.js";

export interface TranscriptCall {
  tool: string;
  arguments?: Record<string, unknown> | undefined;
}

export interface ModelTranscript {
  task_id: string;
  /** Which model produced it. Recorded, never interpreted. */
  model?: string | undefined;
  calls: TranscriptCall[];
  /** What the model told the user. Never scored here. */
  final_answer?: string | undefined;
}

export type FindingLevel = "error" | "warn" | "info" | "unscoreable";

export interface TranscriptFinding {
  level: FindingLevel;
  message: string;
}

export interface TranscriptScore {
  taskId: string;
  model: string;
  roundTrips: number;
  budget: number;
  /** True when nothing mechanical is wrong. NOT "the model did well". */
  mechanicallyClean: boolean;
  findings: TranscriptFinding[];
}

export interface ScoreInputs {
  /** Advertised tools; when absent, only the five known names are checked. */
  toolSchemas?: Map<string, ToolArgumentSchema> | undefined;
  /** Object-type keys this instance exposes; when absent, not checked. */
  knownObjectTypes?: Set<string> | undefined;
}

/** Does `needle` appear in `haystack` in order, not necessarily contiguously? */
function isSubsequence(needle: readonly string[], haystack: readonly string[]): boolean {
  let cursor = 0;
  for (const item of haystack) {
    if (needle[cursor] === item) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return cursor === needle.length;
}

/** The tool names a task's reference sequence uses, in order. */
function referenceTools(task: EvalTask): ToolName[] {
  return task.steps.map((step) => step.tool);
}

export function scoreTranscript(
  task: EvalTask,
  transcript: ModelTranscript,
  inputs: ScoreInputs = {},
): TranscriptScore {
  const findings: TranscriptFinding[] = [];
  const known = new Set<string>(inputs.toolSchemas?.keys() ?? TOOL_NAMES);

  for (const [position, call] of transcript.calls.entries()) {
    const index = position + 1;

    if (!known.has(call.tool)) {
      findings.push({
        level: "error",
        message:
          `call ${index}: \`${call.tool}\` is not a tool this server offers. ` +
          "A model that reaches for a tool that does not exist has invented one, " +
          "which is the failure the impossible-task probe is looking for.",
      });
      continue;
    }

    const schema = inputs.toolSchemas?.get(call.tool);
    const args = call.arguments ?? {};
    if (schema !== undefined) {
      const missing = [...schema.required].filter((name) => !(name in args));
      if (missing.length > 0) {
        findings.push({
          level: "error",
          message: `call ${index} (${call.tool}): missing required argument(s) ${missing.join(", ")}`,
        });
      }
      const unknownArgs = Object.keys(args).filter(
        (name) => !schema.properties.has(name),
      );
      if (unknownArgs.length > 0) {
        findings.push({
          level: "error",
          message: `call ${index} (${call.tool}): argument(s) the tool does not accept: ${unknownArgs.join(", ")}`,
        });
      }
    }

    const objectType = asString(args["object_type"]);
    if (objectType !== undefined && inputs.knownObjectTypes !== undefined) {
      if (!inputs.knownObjectTypes.has(objectType)) {
        findings.push({
          level: "error",
          message: `call ${index} (${call.tool}): \`${objectType}\` is not an object type on this instance`,
        });
      }
    }
  }

  const roundTrips = transcript.calls.length;
  if (roundTrips > task.roundTripBudget) {
    findings.push({
      level: "warn",
      message: `${roundTrips} round-trip(s) against a budget of ${task.roundTripBudget}. Over budget is a finding about the surface, not necessarily about the model.`,
    });
  }

  const actual = transcript.calls.map((call) => call.tool);
  findings.push({
    level: "info",
    message: `sequence: ${actual.join(" -> ") || "(no calls)"}`,
  });
  if (!isSubsequence(referenceTools(task), actual)) {
    findings.push({
      level: "info",
      message:
        `the reference sequence (${referenceTools(task).join(" -> ")}) is not a ` +
        "subsequence of what the model did. That may be fine — a shorter correct " +
        "route exists for several tasks — and is exactly the kind of call a judge makes.",
    });
  }

  findings.push(
    {
      level: "unscoreable",
      message:
        "Whether the final answer is TRUE. Nothing here reads the answer against the instance.",
    },
    {
      level: "unscoreable",
      message: `Whether this route was the right one for: "${task.request}" — ${task.plausibleWrongPath}`,
    },
  );
  if (task.judgement === "human") {
    findings.push({
      level: "unscoreable",
      message:
        "This task is scored on what the model SAID, not on what it called. A run with " +
        "no findings above is not a pass.",
    });
  }

  return {
    taskId: task.id,
    model: transcript.model ?? "unrecorded",
    roundTrips,
    budget: task.roundTripBudget,
    mechanicallyClean: !findings.some((finding) => finding.level === "error"),
    findings,
  };
}

/** Parse a transcripts file: a single transcript or an array of them. */
export function parseTranscripts(raw: string): ModelTranscript[] {
  const parsed: unknown = JSON.parse(raw);
  const entries = asArray(parsed) ?? [parsed];
  return entries.flatMap((entry) => {
    const record = asRecord(entry);
    const taskId = asString(record?.["task_id"]);
    if (record === undefined || taskId === undefined) return [];
    const calls = (asArray(record["calls"]) ?? []).flatMap((item) => {
      const call = asRecord(item);
      const tool = asString(call?.["tool"]);
      if (call === undefined || tool === undefined) return [];
      return [{ tool, arguments: asRecord(call["arguments"]) }];
    });
    return [
      {
        task_id: taskId,
        model: asString(record["model"]),
        calls,
        final_answer: asString(record["final_answer"]),
      },
    ];
  });
}

export function renderScore(score: TranscriptScore): string {
  const lines = [
    `${score.taskId} [${score.model}] — ${score.roundTrips} round-trip(s), budget ${score.budget} — ` +
      `${score.mechanicallyClean ? "no mechanical errors" : "MECHANICAL ERRORS"}`,
  ];
  for (const finding of score.findings) {
    lines.push(`  [${finding.level.padEnd(11)}] ${finding.message}`);
  }
  return lines.join("\n");
}
