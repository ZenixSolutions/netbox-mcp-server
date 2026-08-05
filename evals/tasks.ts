/**
 * The ten tasks.
 *
 * Each one is a request a user would actually make, paired with the tool-call
 * sequence a competent model should produce and a condition a machine can
 * settle. They were chosen to *break* the layered surface, not to demonstrate
 * it: eight of them target a failure mode RFC-003 either admits to or does not
 * discuss, and two target the places the design is least defensible.
 *
 * What is under test is the SHAPE of the surface — whether the work is
 * reachable, how many round-trips it costs, and whether a wrong turn is
 * recoverable from the response alone. Whether a model would in fact take the
 * reference path is a different question and is not scored here; see
 * `evals/README.md`, "What this cannot score".
 *
 * Object types and field names are never hard-coded where the point is that a
 * model should not have to know them: `payloadFromDescribe` builds write
 * payloads out of the describe response and nothing else.
 */

import { asNumber, asRecord, asString } from "../tests/contract/http.js";
import {
  all,
  describesFields,
  describesFilters,
  dependsOn,
  failed,
  hasTotal,
  mentions,
  omits,
  succeeded,
} from "./runner/checks.js";
import { payloadFromDescribe } from "./runner/payload.js";
import type { EvalTask, RunContext, ToolCall } from "./types.js";

/** A string no NetBox object is plausibly displayed as. */
const WRONG_CONFIRM = "not-the-display-value-eval-probe";

/** Prefix for anything a write task would create, so opt-in runs are traceable. */
const PROBE = "eval-probe";

function totalOf(call: ToolCall, resource: string): number | undefined {
  const results = asRecord(call.structured?.["results"]);
  return asNumber(asRecord(results?.[resource])?.["total"]);
}

/* ------------------------------------------------------------------------ */

const E01: EvalTask = {
  id: "E01",
  title: "Interfaces on a named device",
  request: "Show me the interfaces on sw-core-01.",
  probes:
    "Whether a bare hostname can be turned into a scoped list without the model guessing an object_type key.",
  failureMode: "type-ambiguity",
  expectedSequence:
    "netbox_global_search(query=<hostname>) -> netbox_read(dcim.interface, list, filters={device_id})",
  successCondition:
    "The search returns at least one device hit carrying a numeric id, and a subsequent netbox_read on dcim.interface filtered by that id succeeds and reports a total.",
  judgement: "assisted",
  roundTripBudget: 2,
  plausibleWrongPath:
    "netbox_discover -> netbox_describe -> netbox_read (4 calls for a lookup), or a read of `dcim.interfaces` / `interface` — neither is a real object_type key.",
  steps: [
    {
      label: "resolve the hostname without knowing its type",
      tool: "netbox_global_search",
      args: (ctx) => {
        const device = ctx.fixtures.device;
        if (device === undefined) return undefined;
        return { query: device.name ?? device.display, limit_per_resource: 5 };
      },
      expect: (call) =>
        all(
          succeeded(call),
          (totalOf(call, "devices") ?? 0) >= 1
            ? null
            : "global search found no device for a hostname that exists",
        ),
    },
    {
      label: "list that device's interfaces",
      tool: "netbox_read",
      args: (ctx) => {
        const device = ctx.fixtures.device;
        if (device === undefined) return undefined;
        return {
          object_type: "dcim.interface",
          operation: "list",
          filters: { device_id: device.id },
          limit: 10,
        };
      },
      expect: (call) => all(succeeded(call), hasTotal(call)),
    },
  ],
};

const E02: EvalTask = {
  id: "E02",
  title: "Write with guessed field names",
  request: "Create a site called Eval Probe Site in our EMEA region.",
  probes:
    "RFC-003's central claim: that skipping netbox_describe costs nothing because a rejected write returns the description, so the model self-heals in ONE round-trip.",
  failureMode: "wrong-layer-shortcut",
  expectedSequence:
    "netbox_write(dcim.site, create, guessed data) -> [rejected locally] -> netbox_write(dcim.site, create, corrected data)",
  successCondition:
    "The first write is refused without any request being sent, and its error text carries the full field description — enough that a payload assembled from that text alone passes validation on the second attempt.",
  judgement: "mechanical",
  roundTripBudget: 2,
  plausibleWrongPath:
    "The model reads the rejection as a NetBox error, calls netbox_describe anyway, and pays three round-trips instead of two — or drops `slug` and retries the same shape.",
  steps: [
    {
      label: "guess the fields, as a model in a hurry does",
      tool: "netbox_write",
      requiresLocalRejection: true,
      args: () => ({
        object_type: "dcim.site",
        operation: "create",
        data: {
          name: "Eval Probe Site",
          slug: `${PROBE}-site`,
          // Neither of these exists on the write schema: one is invented, the
          // other is computed by NetBox. Both are the classic guess.
          region_name: "EMEA",
          device_count: 0,
        },
      }),
      expect: (call) =>
        all(
          failed(call),
          mentions(
            call,
            "rejected locally",
            "nothing was sent to NetBox",
            "region_name",
            "read-only",
          ),
          mentions(call, "## Required fields", "`name`", "`slug`"),
        ),
    },
    {
      label: "retry using only what the rejection returned",
      tool: "netbox_write",
      mutates: true,
      args: (ctx) => {
        const rejection = ctx.at(1);
        if (rejection === undefined) return undefined;
        // Deliberately NOT assembled from a describe call: the whole claim is
        // that the rejection alone is sufficient.
        if (!rejection.text.includes("`slug`")) return undefined;
        return {
          object_type: "dcim.site",
          operation: "create",
          data: { name: "Eval Probe Site", slug: `${PROBE}-site` },
        };
      },
      expect: (call) => succeeded(call),
    },
  ],
};

const E03: EvalTask = {
  id: "E03",
  title: "Create a device with three prerequisites",
  request: "Add a new switch called eval-probe-sw-01 in rack R1 at site DC1.",
  probes:
    "Whether netbox_describe's `depends on` is enough to order the work, and what that ordering actually costs in round-trips.",
  failureMode: "dependency-ordering",
  expectedSequence:
    "netbox_discover(query='device') -> netbox_describe(dcim.device, create) -> netbox_read x3 (site, device type, role) -> netbox_write(dcim.device, create)",
  successCondition:
    "describe declares dcim.site, dcim.devicetype and dcim.devicerole as prerequisites, and a payload assembled from the describe response alone passes the server's own validation.",
  judgement: "mechanical",
  roundTripBudget: 6,
  plausibleWrongPath:
    "Sending site/device_type/role as names instead of ids, or creating the device before resolving them and treating the 400 as the discovery mechanism.",
  steps: [
    {
      label: "find the object type",
      tool: "netbox_discover",
      args: () => ({ query: "device", app: "dcim" }),
      expect: (call) => all(succeeded(call), mentions(call, "`dcim.device`")),
    },
    {
      label: "learn what a device needs",
      tool: "netbox_describe",
      args: () => ({ object_type: "dcim.device", operation: "create" }),
      expect: (call) =>
        all(
          succeeded(call),
          dependsOn(call, "dcim.site", "dcim.devicetype", "dcim.devicerole"),
          mentions(call, "Must exist first"),
        ),
    },
    {
      label: "resolve the site",
      tool: "netbox_read",
      args: (ctx) => {
        const site = ctx.fixtures.site;
        if (site?.slug === undefined) return undefined;
        return {
          object_type: "dcim.site",
          operation: "list",
          filters: { slug: site.slug },
          limit: 1,
        };
      },
      expect: (call) => all(succeeded(call), hasTotal(call)),
    },
    {
      label: "resolve the device type",
      tool: "netbox_read",
      args: () => ({ object_type: "dcim.devicetype", operation: "list", limit: 1 }),
      expect: (call) => all(succeeded(call), hasTotal(call)),
    },
    {
      label: "resolve the role",
      tool: "netbox_read",
      args: () => ({ object_type: "dcim.devicerole", operation: "list", limit: 1 }),
      expect: (call) => all(succeeded(call), hasTotal(call)),
    },
    {
      label: "create the device from the described fields",
      tool: "netbox_write",
      mutates: true,
      args: (ctx) => {
        const describeCall = ctx.at(2);
        if (describeCall === undefined) return undefined;
        const assembled = payloadFromDescribe(describeCall, ctx.fixtures, {
          name: `${PROBE}-sw-01`,
        });
        if (assembled.unmet.length > 0) return undefined;
        return { object_type: "dcim.device", operation: "create", data: assembled.data };
      },
      expect: (call) => succeeded(call),
    },
  ],
};

const E04: EvalTask = {
  id: "E04",
  title: "A filter name that does not exist",
  request: "Which devices are at the site called DC 1?",
  probes:
    "NetBox answers 200 and the whole unfiltered collection for a parameter it does not recognise. Does the local rejection name a usable alternative, and does one describe call fix it?",
  failureMode: "filter-naming",
  expectedSequence:
    "netbox_read(dcim.device, list, filters={site_name}) -> [rejected] -> netbox_describe(dcim.device, list) -> netbox_read(dcim.device, list, filters={site_id})",
  successCondition:
    "The bad filter name is refused locally with a suggestion, describe lists the real filter, and the corrected read succeeds.",
  judgement: "mechanical",
  roundTripBudget: 3,
  plausibleWrongPath:
    "`site_name` is silently ignored upstream, so without the local check the model reports every device in the estate as being at DC 1 — confidently, and wrongly.",
  steps: [
    {
      label: "filter by the obvious wrong name",
      tool: "netbox_read",
      args: (ctx) => {
        const site = ctx.fixtures.site;
        if (site === undefined) return undefined;
        return {
          object_type: "dcim.device",
          operation: "list",
          filters: { site_name: site.name ?? site.display },
          limit: 5,
        };
      },
      expect: (call) =>
        all(
          failed(call),
          mentions(call, "has no such filter", "site_name"),
          mentions(call, "did you mean"),
          mentions(call, "NOT sent"),
        ),
    },
    {
      label: "consult the filter list",
      tool: "netbox_describe",
      args: () => ({ object_type: "dcim.device", operation: "list" }),
      expect: (call) =>
        all(succeeded(call), describesFilters(call, "site_id"), mentions(call, "site")),
    },
    {
      label: "filter by the real name",
      tool: "netbox_read",
      args: (ctx) => {
        const site = ctx.fixtures.site;
        if (site === undefined) return undefined;
        return {
          object_type: "dcim.device",
          operation: "list",
          filters: { site_id: site.id },
          limit: 5,
        };
      },
      expect: (call) => all(succeeded(call), hasTotal(call)),
    },
  ],
};

const E05: EvalTask = {
  id: "E05",
  title: "A trivial count",
  request: "How many devices are there?",
  probes:
    "Whether the layered surface makes a cheap question expensive. One call should answer it; if the layering forces discover and describe first, the tax is on every conversation.",
  failureMode: "trivial-read-cost",
  expectedSequence: "netbox_read(dcim.device, list, limit=1) — and nothing else",
  successCondition:
    "A single netbox_read succeeds with no prior discover or describe and its structured payload carries a numeric `total`.",
  judgement: "assisted",
  roundTripBudget: 1,
  plausibleWrongPath:
    "netbox_discover -> netbox_describe -> netbox_read, three calls and roughly ten thousand characters of metadata, to return one integer.",
  steps: [
    {
      label: "count devices in one call",
      tool: "netbox_read",
      args: () => ({ object_type: "dcim.device", operation: "list", limit: 1 }),
      expect: (call) => all(succeeded(call), hasTotal(call)),
    },
  ],
};

const E06: EvalTask = {
  id: "E06",
  title: "Delete with confirmation",
  request: "Delete the device eval-probe-sw-01.",
  probes:
    "RFC-003 D2 makes a delete echo the object's own `display`. Does the refusal tell the model exactly what to echo, and does a wrong echo fail closed?",
  failureMode: "delete-confirmation",
  expectedSequence:
    "netbox_read(dcim.device, get) -> netbox_write(delete) [refused, no confirm] -> netbox_write(delete, confirm=<display>)",
  successCondition:
    "The unconfirmed delete is refused before any DELETE is issued and quotes the object's current display; a mismatched confirmation is refused as a mismatch; the display echoed back is byte-identical to the one the read returned.",
  judgement: "mechanical",
  roundTripBudget: 3,
  plausibleWrongPath:
    "Passing the id, the name, or the user's own phrasing as `confirm`, then retrying with a different guess instead of reading the object.",
  steps: [
    {
      label: "read the object first",
      tool: "netbox_read",
      args: (ctx) => {
        const device = ctx.fixtures.device;
        if (device === undefined) return undefined;
        return { object_type: "dcim.device", operation: "get", id: device.id };
      },
      expect: (call) =>
        all(
          succeeded(call),
          asString(asRecord(call.structured?.["item"])?.["display"]) === undefined
            ? "the object carries no `display`, so there is nothing to echo"
            : null,
        ),
    },
    {
      label: "attempt the delete without confirming",
      tool: "netbox_write",
      safeBecause:
        "netbox_write refuses a delete with no `confirm` and issues no DELETE; the refusal is in the tool's control flow, not a property of the data",
      args: (ctx) => {
        const device = ctx.fixtures.device;
        if (device === undefined) return undefined;
        return { object_type: "dcim.device", operation: "delete", id: device.id };
      },
      expect: (call, ctx) => {
        const display = displayFrom(ctx);
        return all(
          failed(call),
          mentions(call, "needs 'confirm'", "cascades"),
          display === undefined || call.text.includes(`confirm="${display}"`)
            ? null
            : "the refusal does not quote the exact string to echo back",
        );
      },
    },
    {
      label: "attempt the delete with the wrong confirmation",
      tool: "netbox_write",
      safeBecause:
        "a confirmation that does not equal the object's display is refused before any DELETE is issued",
      args: (ctx) => {
        const device = ctx.fixtures.device;
        if (device === undefined || device.display === WRONG_CONFIRM) return undefined;
        return {
          object_type: "dcim.device",
          operation: "delete",
          id: device.id,
          confirm: WRONG_CONFIRM,
        };
      },
      expect: (call) =>
        all(failed(call), mentions(call, "confirmation mismatch", WRONG_CONFIRM)),
    },
    {
      label: "delete with the display value the read returned",
      tool: "netbox_write",
      // Never sent. There is no flag under which deleting a real object on
      // somebody's instance is an acceptable thing for an eval to do.
      simulateOnly: true,
      args: (ctx) => {
        const device = ctx.fixtures.device;
        const display = displayFrom(ctx);
        if (device === undefined || display === undefined) return undefined;
        return {
          object_type: "dcim.device",
          operation: "delete",
          id: device.id,
          confirm: display,
        };
      },
      expect: (call, ctx) => {
        const display = displayFrom(ctx);
        return asString(call.args["confirm"]) === display
          ? null
          : "the confirmation does not match the display the read returned";
      },
    },
  ],
};

function displayFrom(ctx: RunContext): string | undefined {
  return asString(asRecord(ctx.at(1)?.structured?.["item"])?.["display"]);
}

const E07: EvalTask = {
  id: "E07",
  title: "A plugin object type nobody can guess",
  request: "List the purchases recorded in our inventory plugin.",
  probes:
    "Plugin keys are derived, not documented. This instance's is `plugins.inventory.purchas` — a singularisation artefact. netbox_discover is the only way to learn it.",
  failureMode: "plugin-object-type",
  expectedSequence:
    "netbox_discover(query='purchase') -> netbox_read(plugins.inventory.purchas, list)",
  successCondition:
    "The guessable key is refused with the real key among its suggestions, discover surfaces the real key, and reading it succeeds.",
  judgement: "mechanical",
  roundTripBudget: 2,
  plausibleWrongPath:
    "netbox_read('plugins.inventory.purchase') — the spelling any reasonable person would use — followed by giving up, or by reporting that the plugin is not installed.",
  steps: [
    {
      label: "guess the key the obvious way",
      tool: "netbox_read",
      args: (ctx) =>
        ctx.fixtures.hasInventoryPlugin
          ? { object_type: "plugins.inventory.purchase", operation: "list", limit: 5 }
          : undefined,
      expect: (call) =>
        all(
          failed(call),
          mentions(call, "Unknown object type", "plugins.inventory.purchas"),
        ),
    },
    {
      label: "discover the real key",
      tool: "netbox_discover",
      args: (ctx) =>
        ctx.fixtures.hasInventoryPlugin ? { query: "purchase" } : undefined,
      expect: (call) =>
        all(succeeded(call), mentions(call, "`plugins.inventory.purchas`")),
    },
    {
      label: "read the plugin collection",
      tool: "netbox_read",
      args: (ctx) =>
        ctx.fixtures.hasInventoryPlugin
          ? { object_type: "plugins.inventory.purchas", operation: "list", limit: 5 }
          : undefined,
      expect: (call) => all(succeeded(call), hasTotal(call)),
    },
  ],
};

const E08: EvalTask = {
  id: "E08",
  title: "Something this surface cannot do",
  request: "Who changed device sw-core-01 last week? Show me its change log.",
  probes:
    "The change-log collection is deliberately excluded from the registry, so the task is impossible. The only correct behaviour is to say so.",
  failureMode: "impossible-task",
  expectedSequence:
    "netbox_discover(query='change') -> [no such type] -> tell the user it is not available through this server",
  successCondition:
    "The registry offers no change-log object type and addressing one directly is refused as unknown. Whether the model then SAYS SO rather than inventing a tool cannot be scored here.",
  judgement: "human",
  roundTripBudget: 2,
  plausibleWrongPath:
    "Inventing `netbox_changelog`, calling netbox_read('core.objectchange') repeatedly with variations, or answering from the object's `last_updated` as though it were an audit trail.",
  steps: [
    {
      label: "look for a change-log type",
      tool: "netbox_discover",
      args: () => ({ query: "change" }),
      expect: (call, ctx) =>
        all(
          succeeded(call),
          omits(call, "objectchange"),
          ctx.fixtures.changeLogTypes.length === 0
            ? null
            : `the registry does expose ${ctx.fixtures.changeLogTypes.join(", ")}; this task is no longer impossible and must be rewritten`,
        ),
    },
    {
      label: "address the change log directly anyway",
      tool: "netbox_read",
      args: () => ({ object_type: "core.objectchange", operation: "list", limit: 5 }),
      expect: (call) => all(failed(call), mentions(call, "Unknown object type")),
    },
  ],
};

const E09: EvalTask = {
  id: "E09",
  title: "A reference the schema cannot describe",
  request: "Assign 192.0.2.77/32 to interface Gi0/1 on sw-core-01.",
  probes:
    "IP assignment is a generic foreign key: a content-type string plus an id. `refersTo` cannot express it, so netbox_describe cannot tell a model what value `assigned_object_type` takes. This is the largest hole in layer 2.",
  failureMode: "generic-foreign-key",
  expectedSequence:
    "netbox_describe(ipam.ipaddress, create) -> netbox_read(dcim.interface, list, filters={device_id}) -> netbox_write(ipam.ipaddress, create)",
  successCondition:
    "describe offers assigned_object_type and assigned_object_id at all, and a payload using them passes local validation. Whether describe explains what STRING assigned_object_type takes is recorded, not asserted — it does not, and that is the finding.",
  judgement: "mechanical",
  roundTripBudget: 3,
  plausibleWrongPath:
    "Sending `interface: <id>`, or `assigned_object: {...}`, or the content-type as `dcim|interface` / `Interface` / an id — every one of which validates locally and fails at NetBox.",
  steps: [
    {
      label: "describe the address",
      tool: "netbox_describe",
      args: () => ({ object_type: "ipam.ipaddress", operation: "create" }),
      expect: (call) =>
        all(
          succeeded(call),
          describesFields(call, "address", "assigned_object_type", "assigned_object_id"),
        ),
    },
    {
      label: "resolve the interface",
      tool: "netbox_read",
      args: (ctx) => {
        const device = ctx.fixtures.device;
        if (device === undefined || ctx.fixtures.deviceInterface === undefined) {
          return undefined;
        }
        return {
          object_type: "dcim.interface",
          operation: "list",
          filters: { device_id: device.id },
          limit: 1,
        };
      },
      expect: (call) => all(succeeded(call), hasTotal(call)),
    },
    {
      label: "create the address bound to that interface",
      tool: "netbox_write",
      mutates: true,
      args: (ctx) => {
        const describeCall = ctx.at(1);
        const iface = ctx.fixtures.deviceInterface;
        if (describeCall === undefined || iface === undefined) return undefined;
        const assembled = payloadFromDescribe(describeCall, ctx.fixtures, {
          address: "192.0.2.77/32",
          assigned_object_type: "dcim.interface",
          assigned_object_id: iface.id,
        });
        if (assembled.unmet.length > 0) return undefined;
        return {
          object_type: "ipam.ipaddress",
          operation: "create",
          data: assembled.data,
        };
      },
      expect: (call) => succeeded(call),
    },
  ],
};

const E10: EvalTask = {
  id: "E10",
  title: "A plausible enum value that is wrong",
  request: "Mark sw-core-01 as decommissioned.",
  probes:
    "The user's word is `decommissioned`; NetBox's value is `decommissioning`. Does the refusal hand back the exact legal values, so the fix is one round-trip and not a guessing game?",
  failureMode: "enum-value",
  expectedSequence:
    "netbox_write(dcim.device, update, status='decommissioned') -> [rejected] -> netbox_write(dcim.device, update, status='decommissioning')",
  successCondition:
    "The wrong value is refused locally, the refusal lists the permitted values including the right one, and nothing is sent.",
  judgement: "mechanical",
  roundTripBudget: 2,
  plausibleWrongPath:
    "Trying `Decommissioned`, then `DECOMMISSIONED`, then giving up — or calling netbox_describe first and paying an extra round-trip for a value the rejection would have handed over.",
  steps: [
    {
      label: "use the word the user used",
      tool: "netbox_write",
      requiresLocalRejection: true,
      args: (ctx) => {
        const device = ctx.fixtures.device;
        if (device === undefined) return undefined;
        return {
          object_type: "dcim.device",
          operation: "update",
          id: device.id,
          data: { status: "decommissioned" },
        };
      },
      expect: (call) =>
        all(
          failed(call),
          mentions(call, "rejected locally", "must be one of", "decommissioning"),
        ),
    },
    {
      label: "use the value the refusal named",
      tool: "netbox_write",
      // An update to a real device is a change to somebody's source of truth
      // even under the write opt-in; the point is made by validating it.
      simulateOnly: true,
      args: (ctx) => {
        const device = ctx.fixtures.device;
        const rejection = ctx.at(1);
        if (device === undefined || rejection === undefined) return undefined;
        const named = legalValuesFrom(rejection.text);
        if (!named.includes("decommissioning")) return undefined;
        return {
          object_type: "dcim.device",
          operation: "update",
          id: device.id,
          data: { status: "decommissioning" },
        };
      },
      expect: (call) => succeeded(call),
    },
  ],
};

/**
 * The values a validation refusal named, parsed back out of its own text.
 *
 * Parsing the message is the point: it is what a model has to do, and if the
 * legal values are not recoverable from the text then the one-round-trip
 * recovery claim is false regardless of what the structured payload holds.
 */
function legalValuesFrom(text: string): string[] {
  const match = /must be one of: ([^.\n]+)/i.exec(text);
  if (match?.[1] === undefined) return [];
  return match[1].split(",").map((value) => value.trim());
}

export const TASKS: readonly EvalTask[] = [
  E01,
  E02,
  E03,
  E04,
  E05,
  E06,
  E07,
  E08,
  E09,
  E10,
];

/** Total round-trip budget across the set; the report compares actuals to it. */
export const TOTAL_BUDGET = TASKS.reduce((sum, task) => sum + task.roundTripBudget, 0);

/** Ids in declaration order; the report and the README are keyed on these. */
export function taskIds(): string[] {
  return TASKS.map((task) => task.id);
}
