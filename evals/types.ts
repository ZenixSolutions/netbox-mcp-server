/**
 * The shape of an evaluation task and of a run against one.
 *
 * A task is a *request a user would actually make*, plus the tool-call
 * sequence a competent model should produce, plus a condition a machine can
 * check. It is deliberately not a unit test: the thing under evaluation is the
 * SHAPE of the tool surface, not the behaviour of any one tool. `tests/` proves
 * the tools work; this proves — as far as anything without a model in the loop
 * can — that the work is reachable.
 *
 * Read `evals/README.md` before adding a task. In particular, read the section
 * on what is and is not automatically scoreable: a task whose success condition
 * is "the model realises it should not do this" cannot be scored here and must
 * be declared `judgement: "human"`.
 */

/** The five tools of the layered surface (RFC-003 D1). */
export type ToolName =
  | "netbox_global_search"
  | "netbox_discover"
  | "netbox_describe"
  | "netbox_read"
  | "netbox_write";

export const TOOL_NAMES: readonly ToolName[] = [
  "netbox_global_search",
  "netbox_discover",
  "netbox_describe",
  "netbox_read",
  "netbox_write",
];

/**
 * The failure mode a task exists to provoke. One task may only carry one:
 * a task that probes two things tells you nothing when it fails.
 */
export type FailureMode =
  | "type-ambiguity"
  | "wrong-layer-shortcut"
  | "dependency-ordering"
  | "filter-naming"
  | "trivial-read-cost"
  | "delete-confirmation"
  | "plugin-object-type"
  | "impossible-task"
  | "generic-foreign-key"
  | "enum-value";

/**
 * How much of this task's success condition a machine can settle.
 *
 * - `mechanical` — fully decided by the runner. No opinion involved.
 * - `assisted`   — the runner decides whether the reference path WORKS; whether
 *                  a model would CHOOSE it needs a model or a human.
 * - `human`      — the interesting half is a judgement (did it refuse? did it
 *                  explain?) and the runner only establishes the ground truth
 *                  that judgement is measured against.
 */
export type Judgement = "mechanical" | "assisted" | "human";

/** One recorded tool call — executed or simulated. */
export interface ToolCall {
  /** 1-based position in this task's sequence. */
  index: number;
  tool: ToolName;
  args: Record<string, unknown>;
  /** True when the call was NOT sent (a write, in the default read-only mode). */
  simulated: boolean;
  isError: boolean;
  /** Concatenated text content of the result, or the simulation verdict. */
  text: string;
  structured: Record<string, unknown> | undefined;
  elapsedMs: number;
}

/** Everything a step may consult: the calls so far, and the live fixtures. */
export interface RunContext {
  calls: ToolCall[];
  fixtures: Fixtures;
  /** The most recent call, or undefined before the first. */
  last(): ToolCall | undefined;
  /** A previously recorded call by 1-based index. */
  at(index: number): ToolCall | undefined;
}

/**
 * A step is one tool call the reference path makes.
 *
 * `args` returning `undefined` means "this instance cannot support the step" —
 * usually a missing fixture — and marks the whole task `unverified` rather than
 * failed, exactly as the contract suite does for a type it holds no objects of.
 */
export interface EvalStep {
  label: string;
  tool: ToolName;
  args: (ctx: RunContext) => Record<string, unknown> | undefined;
  /**
   * True when executing this step would CHANGE the instance. Never executed
   * unless writes are explicitly opted in; otherwise simulated (validated
   * locally against the instance's own schema and recorded, not sent).
   */
  mutates?: boolean;
  /**
   * Never send this call, not even with writes opted in. For steps whose real
   * execution would destroy something that already exists — the final delete
   * in the confirmation task is the only honest way to end that sequence, and
   * there is no flag under which deleting a stranger's device is acceptable.
   */
  simulateOnly?: boolean;
  /**
   * Declares that this `netbox_write` call must be refused by the server's own
   * local validation. The runner PROVES that before executing it — it runs the
   * same validation the tool runs and refuses to make the call if the payload
   * would in fact be accepted. This is how a write probe stays read-only.
   */
  requiresLocalRejection?: boolean;
  /**
   * Why executing this step cannot modify anything, when that is not obvious.
   * Recorded in the report; a write step needs one of these, `mutates`, or
   * `requiresLocalRejection`, or the runner refuses to run it at all.
   */
  safeBecause?: string;
  /** Return null when the result is what it should be, else what was wrong. */
  expect?: (call: ToolCall, ctx: RunContext) => string | null;
}

export interface EvalTask {
  /** Stable id, e.g. `E01`. Referenced by the report and by issues. */
  id: string;
  title: string;
  /** The request, phrased as a user would phrase it. */
  request: string;
  /** What this task exists to find out. One sentence, blunt. */
  probes: string;
  failureMode: FailureMode;
  /**
   * The tool-call sequence a competent model should produce, as prose the
   * report prints verbatim. The executable version is `steps`.
   */
  expectedSequence: string;
  /** The machine-checkable condition, in words. The code is in `steps`. */
  successCondition: string;
  judgement: Judgement;
  /**
   * The round-trip budget this task is expected to fit in. Exceeding it is
   * NOT a failure — it is the finding. The design's central claim is about
   * this number.
   */
  roundTripBudget: number;
  /** What a model choosing badly would look like, for the human scorer. */
  plausibleWrongPath: string;
  steps: EvalStep[];
}

/** Live objects the reference paths address, resolved once per run. */
export interface Fixtures {
  device: FixtureObject | undefined;
  site: FixtureObject | undefined;
  rack: FixtureObject | undefined;
  deviceType: FixtureObject | undefined;
  deviceRole: FixtureObject | undefined;
  /** An interface on `device`, when it has one. */
  deviceInterface: FixtureObject | undefined;
  /** True when `plugins.inventory.purchas` resolves on this instance. */
  hasInventoryPlugin: boolean;
  /** Object-type keys the registry actually exposes; for the impossible task. */
  changeLogTypes: string[];
}

export interface FixtureObject {
  id: number;
  /** NetBox's own `display` value — the string a delete has to echo. */
  display: string;
  name: string | undefined;
  slug: string | undefined;
}

export type Verdict = "pass" | "fail" | "unverified";

export interface StepOutcome {
  step: number;
  label: string;
  tool: ToolName;
  ok: boolean;
  simulated: boolean;
  detail: string;
}

export interface TaskRun {
  task: EvalTask;
  verdict: Verdict;
  /** Why, in one line. */
  detail: string;
  calls: ToolCall[];
  steps: StepOutcome[];
  /** 1-based index of the first step that went wrong, if any. */
  firstWrongStep: number | undefined;
  /**
   * Calls the model would have to make: executed plus simulated. This is the
   * number RFC-003's "Round-trips to first write" row is a claim about.
   */
  roundTrips: number;
  executedCalls: number;
  simulatedCalls: number;
  elapsedMs: number;
}
