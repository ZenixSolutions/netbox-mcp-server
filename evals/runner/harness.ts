/**
 * Opt-in, safety, and execution of one task.
 *
 * Three responsibilities, in descending order of how much they matter:
 *
 *  1. **Safety.** This suite drives the real `netbox_write` tool against
 *     somebody's source of truth. It is strictly read-only by default, and
 *     that is enforced in code rather than promised in a comment: a step that
 *     would change anything is either simulated, or executed only after the
 *     runner has PROVEN — using the same validator the tool uses — that the
 *     server will refuse it before a request is sent. `assertReadOnlySafe` is
 *     the single gate; a task that does not satisfy it cannot run at all.
 *  2. **Opt-in.** Without `NETBOX_URL` and `NETBOX_TOKEN` every task is
 *     skipped, loudly but not fatally, exactly as `tests/contract/` does.
 *     `npm test` never loads this file (`vitest.eval.config.ts` is separate,
 *     and `vitest.config.ts` only includes `tests/`).
 *  3. **Recording.** Every call, executed or simulated, lands in the
 *     transcript with its arguments, so the report can show what sequence was
 *     actually taken and where it first went wrong.
 */

import { validateWriteData } from "../../src/tools/layered/validate.js";
import { asNumber, asRecord, asString } from "../../tests/contract/http.js";
import { contractEnv } from "../../tests/contract/harness.js";
import type {
  EvalStep,
  EvalTask,
  Fixtures,
  FixtureObject,
  RunContext,
  StepOutcome,
  TaskRun,
  ToolCall,
} from "../types.js";
import type { Session } from "./session.js";

export const SKIP_MESSAGE =
  "netbox-mcp eval set SKIPPED: NETBOX_URL and NETBOX_TOKEN are not both set.\n" +
  "  These tasks drive the real tool surface against a real NetBox instance and are\n" +
  "  opt-in by design. Run them with:\n" +
  "    NETBOX_URL=https://netbox.example.com NETBOX_TOKEN=<token> npm run eval\n" +
  "  Read-only by default: no task modifies anything unless NETBOX_EVAL_ALLOW_WRITES=1.";

function truthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

export const EVAL_ENABLED = contractEnv() !== undefined;

export function evalBaseUrl(): string {
  const configured = contractEnv();
  if (!configured) throw new Error(SKIP_MESSAGE);
  return configured.baseUrl;
}

/**
 * Whether mutating steps may actually be sent.
 *
 * Off unless explicitly set. When off, a mutating step is validated locally
 * against the instance's own schema and recorded as simulated — which answers
 * "would this payload have been accepted" without answering it destructively.
 */
export function allowWrites(): boolean {
  return truthy(process.env["NETBOX_EVAL_ALLOW_WRITES"]);
}

/* ------------------------------------------------------------------------ */
/* Safety                                                                     */
/* ------------------------------------------------------------------------ */

export class UnsafeStepError extends Error {}

/**
 * Refuse to execute a `netbox_write` step that has not been shown to be inert.
 *
 * A write step qualifies in exactly three ways:
 *   - `requiresLocalRejection` — and the payload has just been proven invalid
 *     by the same validator the server runs, so nothing will leave the process.
 *   - `safeBecause` — the call is refused by the tool for a structural reason
 *     the runner does not have to guess at (a delete with no `confirm` is
 *     rejected before any DELETE is issued; the tool's own code path decides
 *     this, not the data).
 *   - `mutates` with writes explicitly opted in.
 *
 * Anything else throws, which fails the task loudly rather than quietly
 * writing to somebody's production instance.
 */
function assertReadOnlySafe(step: EvalStep, provenInert: boolean): void {
  if (step.tool !== "netbox_write") return;
  if (step.simulateOnly === true) {
    throw new UnsafeStepError(
      `Refusing to execute step "${step.label}": it is marked simulateOnly and must ` +
        "never be sent under any flag.",
    );
  }
  if (step.requiresLocalRejection === true && provenInert) return;
  if (step.safeBecause !== undefined) return;
  if (step.mutates === true && allowWrites()) return;
  throw new UnsafeStepError(
    `Refusing to execute step "${step.label}": a netbox_write step must be proven ` +
      "inert, structurally refused, or an opted-in mutation.",
  );
}

/**
 * A `netbox_write` step must SAY how it is safe. A task that adds one without
 * declaring anything is a bug in the task, and it fails here rather than in
 * somebody's database.
 */
function assertDeclared(step: EvalStep): void {
  if (step.tool !== "netbox_write") return;
  const declared =
    step.simulateOnly === true ||
    step.requiresLocalRejection === true ||
    step.safeBecause !== undefined ||
    step.mutates === true;
  if (!declared) {
    throw new UnsafeStepError(
      `Step "${step.label}" calls netbox_write without declaring \`simulateOnly\`, ` +
        "`requiresLocalRejection`, `safeBecause` or `mutates`. Refusing to run the task.",
    );
  }
}

/* ------------------------------------------------------------------------ */
/* Local write validation — the same check the server performs               */
/* ------------------------------------------------------------------------ */

export interface LocalValidation {
  /** True when the payload WOULD be sent to NetBox. */
  wouldSend: boolean;
  detail: string;
}

/**
 * Run `netbox_write`'s own local validation without calling the tool.
 *
 * Used for two opposite purposes: to prove a probe is inert before executing
 * it, and to decide whether a simulated write would have been accepted.
 */
export async function validateLocally(
  session: Session,
  args: Record<string, unknown>,
): Promise<LocalValidation> {
  const objectType = asString(args["object_type"]) ?? "";
  const operation = asString(args["operation"]) ?? "";
  if (operation === "delete") {
    const confirm = asString(args["confirm"]);
    return {
      wouldSend: confirm !== undefined && confirm.trim() !== "",
      detail:
        confirm === undefined
          ? "delete without `confirm`: the tool refuses before issuing any DELETE"
          : `delete with confirm="${confirm}": would proceed if it matches the object's display`,
    };
  }
  if (operation !== "create" && operation !== "update") {
    return { wouldSend: false, detail: `unrecognised operation "${operation}"` };
  }
  const data = asRecord(args["data"]);
  if (data === undefined) {
    return { wouldSend: false, detail: "no `data`: the tool rejects this locally" };
  }

  const described = await session.schema
    .describe(objectType, operation)
    .catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    );
  if (described instanceof Error) {
    return {
      wouldSend: false,
      detail: `could not describe ${objectType}: ${described.message}`,
    };
  }

  const outcome = validateWriteData(data, described, operation);
  return {
    wouldSend: outcome.ok,
    detail: outcome.ok
      ? "payload passes the server's own local validation"
      : outcome.errors.join("; "),
  };
}

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                   */
/* ------------------------------------------------------------------------ */

function toFixture(item: unknown): FixtureObject | undefined {
  const record = asRecord(item);
  const id = asNumber(record?.["id"]);
  if (record === undefined || id === undefined) return undefined;
  const name = asString(record["name"]);
  const slug = asString(record["slug"]);
  return {
    id,
    display: asString(record["display"]) ?? name ?? slug ?? `#${id}`,
    name,
    slug,
  };
}

async function firstOf(
  session: Session,
  objectType: string,
  filters?: Record<string, unknown>,
): Promise<FixtureObject | undefined> {
  const call = await session.call(
    "netbox_read",
    {
      object_type: objectType,
      operation: "list",
      limit: 1,
      response_format: "json",
      ...(filters === undefined ? {} : { filters }),
    },
    0,
  );
  if (call.isError) return undefined;
  const items = call.structured?.["items"];
  return Array.isArray(items) ? toFixture(items[0]) : undefined;
}

/**
 * Resolve the live objects the reference paths address.
 *
 * These calls are NOT part of any task's transcript and are not counted as
 * round-trips: they stand in for context a real user's conversation would
 * already contain ("sw-core-01" is a device that exists). A fixture the
 * instance cannot supply makes the tasks that need it `unverified`, which is
 * the same thing the contract suite does for an object type it holds none of.
 */
export async function resolveFixtures(session: Session): Promise<Fixtures> {
  const [site, device, rack, deviceType, deviceRole] = await Promise.all([
    firstOf(session, "dcim.site"),
    firstOf(session, "dcim.device"),
    firstOf(session, "dcim.rack"),
    firstOf(session, "dcim.devicetype"),
    firstOf(session, "dcim.devicerole"),
  ]);

  const deviceInterface =
    device === undefined
      ? undefined
      : await firstOf(session, "dcim.interface", { device_id: device.id });

  const hasInventoryPlugin =
    (await session.schema.resolve("plugins.inventory.purchas")) !== undefined;

  const changeLogTypes = (await session.schema.listObjectTypes({ query: "change" })).map(
    (summary) => summary.object_type,
  );

  return {
    site,
    device,
    rack,
    deviceType,
    deviceRole,
    deviceInterface,
    hasInventoryPlugin,
    changeLogTypes,
  };
}

/* ------------------------------------------------------------------------ */
/* Execution                                                                  */
/* ------------------------------------------------------------------------ */

function context(calls: ToolCall[], fixtures: Fixtures): RunContext {
  return {
    calls,
    fixtures,
    last: () => calls[calls.length - 1],
    at: (index: number) => calls.find((call) => call.index === index),
  };
}

/** Execute one task's reference sequence and score it. */
export async function runTask(
  session: Session,
  task: EvalTask,
  fixtures: Fixtures,
): Promise<TaskRun> {
  const startedAt = Date.now();
  const calls: ToolCall[] = [];
  const steps: StepOutcome[] = [];
  let firstWrongStep: number | undefined;
  let verdict: TaskRun["verdict"] = "pass";
  let detail = "every step behaved as the task requires";

  for (const [position, step] of task.steps.entries()) {
    const index = position + 1;
    const ctx = context(calls, fixtures);

    const args = step.args(ctx);
    if (args === undefined) {
      verdict = "unverified";
      detail = `step ${index} (${step.label}) cannot be built on this instance — a required fixture is missing`;
      steps.push({
        step: index,
        label: step.label,
        tool: step.tool,
        ok: false,
        simulated: false,
        detail: "not attempted: missing fixture",
      });
      break;
    }

    let call: ToolCall;
    if (step.tool === "netbox_write") {
      assertDeclared(step);
      const local = await validateLocally(session, args);

      if (step.requiresLocalRejection === true && local.wouldSend) {
        // The probe depends on the server rejecting this payload. It would
        // not. Executing it would create or change a real object, so it does
        // not run — and the task reports that it could not be verified here.
        verdict = "unverified";
        detail =
          `step ${index} (${step.label}) was designed to be rejected locally, but this ` +
          `instance's schema accepts it (${local.detail}). Not sent.`;
        steps.push({
          step: index,
          label: step.label,
          tool: step.tool,
          ok: false,
          simulated: true,
          detail: "not attempted: the deliberately-bad payload is valid here",
        });
        break;
      }

      const executeForReal =
        step.simulateOnly !== true &&
        ((step.requiresLocalRejection === true && !local.wouldSend) ||
          step.safeBecause !== undefined ||
          (step.mutates === true && allowWrites()));
      // The gate is checked only on the path that actually sends: a step that
      // is going to be simulated has already been made harmless.
      if (executeForReal) assertReadOnlySafe(step, !local.wouldSend);

      call = executeForReal
        ? await session.call(step.tool, args, index)
        : session.simulate(
            step.tool,
            args,
            index,
            `SIMULATED (read-only mode; set NETBOX_EVAL_ALLOW_WRITES=1 to send it): ${local.detail}`,
            !local.wouldSend,
          );
    } else {
      call = await session.call(step.tool, args, index);
    }

    calls.push(call);

    const problem = step.expect?.(call, context(calls, fixtures)) ?? null;
    steps.push({
      step: index,
      label: step.label,
      tool: step.tool,
      ok: problem === null,
      simulated: call.simulated,
      detail: problem ?? summarise(call),
    });

    if (problem !== null) {
      verdict = "fail";
      firstWrongStep = index;
      detail = `step ${index} (${step.label}): ${problem}`;
      break;
    }
  }

  return {
    task,
    verdict,
    detail,
    calls,
    steps,
    firstWrongStep,
    roundTrips: calls.length,
    executedCalls: calls.filter((call) => !call.simulated).length,
    simulatedCalls: calls.filter((call) => call.simulated).length,
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Remove anything a task actually created, newest first.
 *
 * Only reachable with writes opted in, and only for objects this run made:
 * the id and the `display` both come out of the create response. Failures are
 * returned rather than thrown — a cleanup that cannot complete must be
 * reported to the operator, not hidden behind a red test.
 */
export async function cleanupCreated(session: Session, run: TaskRun): Promise<string[]> {
  const notes: string[] = [];
  const created = run.calls
    .filter(
      (call) =>
        !call.simulated &&
        !call.isError &&
        call.tool === "netbox_write" &&
        asString(call.args["operation"]) === "create",
    )
    .reverse();

  for (const call of created) {
    const item = asRecord(call.structured?.["item"]);
    const id = asNumber(item?.["id"]);
    const display = asString(item?.["display"]);
    const objectType = asString(call.args["object_type"]);
    if (id === undefined || display === undefined || objectType === undefined) {
      notes.push(
        `could not clean up the object created by ${run.task.id} step ${call.index}: ` +
          "the create response carried no id or display",
      );
      continue;
    }
    const result = await session.call(
      "netbox_write",
      { object_type: objectType, operation: "delete", id, confirm: display },
      0,
    );
    notes.push(
      result.isError
        ? `CLEANUP FAILED for ${objectType} id=${id} ("${display}"): ${result.text.split("\n")[0] ?? ""}`
        : `cleaned up ${objectType} id=${id} ("${display}")`,
    );
  }
  return notes;
}

function summarise(call: ToolCall): string {
  const head = call.text.split("\n").find((line) => line.trim().length > 0) ?? "";
  const prefix = call.simulated ? "simulated" : call.isError ? "error" : "ok";
  return `${prefix}: ${head.slice(0, 160)}`;
}
