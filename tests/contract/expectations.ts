/**
 * The half of the harness that touches `vitest`.
 *
 * It is separate from `harness.ts` for a mechanical reason: `global-setup.ts`
 * runs outside a test worker and cannot reach vitest's internal state, so
 * anything it imports must not import `vitest`. It imports `harness.ts`; this
 * file is imported only by the test files.
 */

import { describe, expect } from "vitest";

import { CONTRACT_ENABLED, record } from "./harness.js";
import type { Observation } from "./observations.js";

/**
 * `describe`, or `describe.skip` when credentials are absent.
 *
 * Skipping rather than failing is the contract with CI: this suite is part of
 * the repository but is never a reason for a red build.
 */
export function describeContract(name: string, body: () => void): void {
  if (CONTRACT_ENABLED) {
    describe(name, body);
  } else {
    describe.skip(`${name} — SKIPPED, set NETBOX_URL and NETBOX_TOKEN to run`, body);
  }
}

/**
 * Record an observation and fail the test if it is a mismatch.
 *
 * The failure message repeats derived-vs-actual, so a vitest transcript is
 * readable on its own without the generated report.
 */
export function check(observation: Observation): void {
  record(observation);
  if (observation.verdict === "mismatch") {
    expect.fail(
      [
        observation.check,
        `  derived: ${observation.derived}`,
        `  actual:  ${observation.actual}`,
        ...(observation.note === undefined ? [] : [`  note:    ${observation.note}`]),
      ].join("\n"),
    );
  }
}

/**
 * Record every observation, then fail once listing all mismatches.
 *
 * "Report every one, do not stop at the first" — a suite that aborts on the
 * first bad endpoint tells the operator to run it again N times.
 */
export function checkAll(observations: readonly Observation[]): void {
  for (const observation of observations) record(observation);
  const bad = observations.filter((o) => o.verdict === "mismatch");
  if (bad.length > 0) {
    expect.fail(
      [
        `${bad.length} of ${observations.length} check(s) contradicted the derivation:`,
        ...bad.map(
          (o) =>
            `  - ${o.check}\n      derived: ${o.derived}\n      actual:  ${o.actual}`,
        ),
      ].join("\n"),
    );
  }
}
