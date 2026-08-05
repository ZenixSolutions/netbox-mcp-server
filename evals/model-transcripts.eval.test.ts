/**
 * Scores transcripts produced by an actual model, when you have some.
 *
 * The task suite establishes that the reference paths work. This establishes
 * what a given model actually did with them — but only the mechanical half.
 * It fails on things that are unambiguously wrong (a tool that does not exist,
 * arguments the tool does not accept, an object type this instance lacks) and
 * prints, for every task, what a human or an LLM judge still has to decide.
 *
 * Skipped entirely unless `NETBOX_EVAL_TRANSCRIPTS` points at a JSON file:
 *
 *   [{ "task_id": "E03", "model": "…", "calls": [{ "tool": "netbox_discover",
 *      "arguments": { "query": "device" } }], "final_answer": "…" }]
 */

import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EVAL_ENABLED } from "./runner/harness.js";
import {
  parseTranscripts,
  renderScore,
  scoreTranscript,
  type ScoreInputs,
} from "./runner/score-transcript.js";
import { openSession, type Session } from "./runner/session.js";
import { TASKS } from "./tasks.js";

const TRANSCRIPTS = (process.env["NETBOX_EVAL_TRANSCRIPTS"] ?? "").trim();

function describeTranscripts(name: string, body: () => void): void {
  if (TRANSCRIPTS !== "") {
    describe(name, body);
  } else {
    describe.skip(`${name} — SKIPPED, set NETBOX_EVAL_TRANSCRIPTS to a JSON file`, body);
  }
}

describeTranscripts("model transcripts", () => {
  let session: Session | undefined;
  let inputs: ScoreInputs = {};

  beforeAll(async () => {
    // The instance is optional here: without it the tool names are still
    // checked, only the argument and object-type checks are skipped.
    if (!EVAL_ENABLED) return;
    session = await openSession();
    inputs = {
      toolSchemas: session.toolSchemas,
      knownObjectTypes: new Set(
        (await session.schema.listObjectTypes()).map((summary) => summary.object_type),
      ),
    };
  }, 300_000);

  afterAll(async () => {
    await session?.close();
  });

  it("scores every transcript it was given", () => {
    const transcripts = parseTranscripts(readFileSync(TRANSCRIPTS, "utf8"));
    expect(transcripts.length, `no usable transcript in ${TRANSCRIPTS}`).toBeGreaterThan(
      0,
    );

    const unmatched: string[] = [];
    const broken: string[] = [];

    for (const transcript of transcripts) {
      const task = TASKS.find((candidate) => candidate.id === transcript.task_id);
      if (task === undefined) {
        unmatched.push(transcript.task_id);
        continue;
      }
      const score = scoreTranscript(task, transcript, inputs);
      console.log(renderScore(score));
      if (!score.mechanicallyClean) broken.push(task.id);
    }

    expect(
      unmatched,
      `transcripts name unknown task ids: ${unmatched.join(", ")}`,
    ).toEqual([]);
    expect(
      broken,
      "these transcripts contain calls that could not have worked: " + broken.join(", "),
    ).toEqual([]);
  });
});
