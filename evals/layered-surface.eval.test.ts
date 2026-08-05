/**
 * Executes the ten tasks against a live instance.
 *
 * A failing task means the REFERENCE PATH is broken — the sequence a competent
 * model should take does not work, or the surface cannot express the request.
 * It does not mean a model chose badly; nothing here has a model in it. Read
 * `evals/README.md` before drawing a conclusion from a green run.
 *
 * Skipped in full without `NETBOX_URL` and `NETBOX_TOKEN`, and never loaded by
 * `npm test`: `vitest.config.ts` includes `tests/` only, and this suite has
 * its own config.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appendRun, toRecord } from "./runner/observations.js";
import {
  allowWrites,
  cleanupCreated,
  evalBaseUrl,
  EVAL_ENABLED,
  resolveFixtures,
  runTask,
  SKIP_MESSAGE,
} from "./runner/harness.js";
import { openSession, type Session } from "./runner/session.js";
import { TASKS } from "./tasks.js";
import type { Fixtures } from "./types.js";

/** `describe`, or `describe.skip` when credentials are absent. */
function describeEval(name: string, body: () => void): void {
  if (EVAL_ENABLED) {
    describe(name, body);
  } else {
    describe.skip(`${name} — SKIPPED, set NETBOX_URL and NETBOX_TOKEN to run`, body);
  }
}

describeEval("layered tool surface — task set", () => {
  let session: Session | undefined;
  let fixtures: Fixtures | undefined;

  const active = (): Session => {
    if (session === undefined) throw new Error(SKIP_MESSAGE);
    return session;
  };
  const resolved = (): Fixtures => {
    if (fixtures === undefined) throw new Error("fixtures were not resolved");
    return fixtures;
  };

  beforeAll(async () => {
    session = await openSession();
    fixtures = await resolveFixtures(session);
    console.log(
      "fixtures: " +
        Object.entries({
          site: fixtures.site?.display,
          device: fixtures.device?.display,
          rack: fixtures.rack?.display,
          device_type: fixtures.deviceType?.display,
          role: fixtures.deviceRole?.display,
          interface: fixtures.deviceInterface?.display,
          inventory_plugin: fixtures.hasInventoryPlugin,
        })
          .map(([key, value]) => `${key}=${String(value ?? "none")}`)
          .join(", "),
    );
  }, 300_000);

  afterAll(async () => {
    await session?.close();
  });

  it("every task addresses a tool this server actually advertises", () => {
    const advertised = new Set(active().advertised);
    const missing = TASKS.flatMap((task) =>
      task.steps
        .map((step) => step.tool)
        .filter((tool) => !advertised.has(tool))
        .map((tool) => `${task.id}: ${tool}`),
    );
    expect(missing, `tasks name tools that do not exist: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  for (const task of TASKS) {
    it(`${task.id} — ${task.title}`, async () => {
      const run = await runTask(active(), task, resolved());
      appendRun(evalBaseUrl(), toRecord(run));

      if (allowWrites()) {
        for (const note of await cleanupCreated(active(), run)) console.log(note);
      }

      console.log(
        `${task.id}: ${run.verdict} — ${run.roundTrips} round-trip(s) ` +
          `(budget ${task.roundTripBudget}, ${run.simulatedCalls} simulated) — ${run.detail}`,
      );

      if (run.verdict === "unverified") {
        // Not a failure. The instance cannot supply what the task needs, the
        // same way the contract suite cannot check a type it holds none of.
        console.log(`${task.id}: NOT VERIFIED — ${run.detail}`);
        return;
      }

      expect(
        run.verdict,
        [
          run.detail,
          `sequence: ${run.calls.map((call) => call.tool).join(" -> ")}`,
          `success condition: ${task.successCondition}`,
        ].join("\n"),
      ).toBe("pass");
    }, 300_000);
  }
});
