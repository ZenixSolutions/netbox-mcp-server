/**
 * 4. Field derivation vs returned objects, and 5. enums.
 *
 * `netbox_describe` tells a model which fields exist, which are required and
 * which are read-only, entirely from the schema document. A model then acts on
 * that. So the question worth money is not "does describe run" but "does the
 * object NetBox actually returns look like what describe promised".
 *
 * Two failure directions, both reported:
 *   - a field the schema declares that never appears in a real object;
 *   - a field a real object carries that the schema does not declare.
 *
 * Enums matter for a specific reason. `src/tools/layered/validate.ts` rejects
 * any value outside the derived `enum` LOCALLY, before the request is sent. If
 * NetBox returns a value the derived enum does not contain — different case,
 * an instance-specific choice, a plugin field — then a model reading an object
 * and writing it back is refused by our own validator for a value NetBox
 * itself produced. The sibling server found exactly this, as capitalisation.
 */

import { beforeAll, it } from "vitest";

import { describeObjectType } from "../../src/schema/describe.js";
import {
  readSchemaOf,
  type RegistryEntry,
  type SchemaRegistry,
} from "../../src/schema/registry.js";
import type { FieldSpec } from "../../src/schema/types.js";
import { asArray, asNumber, asRecord, jsonType, parseJson, preview } from "./http.js";
import { api, derivedRegistry, mapLimited, record } from "./harness.js";
import { checkAll, describeContract } from "./expectations.js";
import type { Observation } from "./observations.js";

const SECTION_FIELDS = "4. Field derivation vs returned objects";
const SECTION_ENUMS = "5. Enum values";

/**
 * Types worth checking first: broad coverage of apps, serializer shapes and
 * the awkward cases (`DeviceWithConfigContext`, `users.permission`, the
 * generic-relation-heavy `dcim.cable`).
 */
const PREFERRED = [
  "dcim.site",
  "dcim.device",
  "dcim.devicetype",
  "dcim.devicerole",
  "dcim.manufacturer",
  "dcim.rack",
  "dcim.interface",
  "dcim.cable",
  "dcim.location",
  "ipam.prefix",
  "ipam.ipaddress",
  "ipam.vlan",
  "ipam.vrf",
  "ipam.aggregate",
  "tenancy.tenant",
  "virtualization.virtualmachine",
  "virtualization.cluster",
  "circuits.circuit",
  "circuits.provider",
  "extras.tag",
  "users.user",
  "users.permission",
];

function sampleSize(): number {
  const raw = process.env["NETBOX_CONTRACT_FIELD_SAMPLE"];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

interface Sampled {
  objectType: string;
  entry: RegistryEntry;
  /** A real object fetched from the detail endpoint, or undefined. */
  object: Record<string, unknown> | undefined;
  reason: string;
}

describeContract(`${SECTION_FIELDS} + ${SECTION_ENUMS}`, () => {
  let registry: SchemaRegistry;
  let sampled: Sampled[] = [];

  beforeAll(async () => {
    registry = await derivedRegistry();
    const keys = [
      ...PREFERRED.filter((key) => registry.types.has(key)),
      ...[...registry.types.keys()].filter((key) => !PREFERRED.includes(key)),
    ].slice(0, sampleSize());

    sampled = await mapLimited(keys, 4, async (key): Promise<Sampled> => {
      const entry = registry.types.get(key);
      // `keys` is built from the registry itself, so this cannot fire.
      if (!entry) throw new Error(`${key} vanished from the registry mid-run`);
      const list = await api(`/${entry.summary.endpoint}/?limit=1`);
      if (list.status !== 200) {
        return {
          objectType: key,
          entry,
          object: undefined,
          reason: `list returned HTTP ${list.status}`,
        };
      }
      const page = asRecord(parseJson(list.body));
      const total = asNumber(page?.["count"]) ?? 0;
      const first = asRecord((asArray(page?.["results"]) ?? [])[0]);
      if (!first) {
        return {
          objectType: key,
          entry,
          object: undefined,
          reason: `the instance holds ${total} object(s) of this type`,
        };
      }
      const id = asNumber(first["id"]);
      if (id === undefined) return { objectType: key, entry, object: first, reason: "" };
      const detail = await api(`/${entry.summary.endpoint}/${id}/`);
      if (detail.status !== 200) {
        return { objectType: key, entry, object: first, reason: "" };
      }
      return {
        objectType: key,
        entry,
        object: asRecord(parseJson(detail.body)) ?? first,
        reason: "",
      };
    });
  }, 600_000);

  it("declares every field a real object carries, and no field it does not", () => {
    const observations: Observation[] = [];

    for (const { objectType, entry, object, reason } of sampled) {
      if (!object) {
        observations.push({
          section: SECTION_FIELDS,
          check: `${objectType} field set`,
          derived: "the read component's property list",
          actual: `not checked — ${reason}`,
          verdict: "unverified",
        });
        continue;
      }

      const readSchema = readSchemaOf(registry, entry);
      const declared = Object.keys(readSchema?.properties ?? {});
      if (declared.length === 0) {
        observations.push({
          section: SECTION_FIELDS,
          check: `${objectType} field set`,
          derived: "a read component with properties",
          actual: `the schema resolves no read component (readSchemaName=${entry.readSchemaName ?? "none"})`,
          verdict: "mismatch",
          note: "netbox_describe cannot name a single read-only field for this type.",
        });
        continue;
      }

      const returned = Object.keys(object);
      const requiredOnRead = new Set(readSchema?.required ?? []);
      const missing = declared.filter((name) => !returned.includes(name));
      const undeclared = returned.filter((name) => !declared.includes(name));
      const missingRequired = missing.filter((name) => requiredOnRead.has(name));

      observations.push({
        section: SECTION_FIELDS,
        check: `${objectType} — fields the schema declares but the object omits`,
        derived: `${declared.length} declared propert(ies); ${requiredOnRead.size} of them listed in \`required\``,
        actual:
          missing.length === 0
            ? "none omitted"
            : `${missing.length} omitted: ${missing.join(", ")}` +
              (missingRequired.length > 0
                ? ` — of which ${missingRequired.length} are in the component's own \`required\`: ${missingRequired.join(", ")}`
                : ""),
        verdict:
          missingRequired.length > 0 ? "mismatch" : missing.length > 0 ? "info" : "match",
        note:
          missingRequired.length > 0
            ? "`required` on a response component means 'always present in the response' " +
              "(derivation §3.2). These are not, so that reading is wrong on this instance."
            : undefined,
      });

      observations.push({
        section: SECTION_FIELDS,
        check: `${objectType} — fields the object carries but the schema does not declare`,
        derived: "none; the read component is meant to be the complete response shape",
        actual:
          undeclared.length === 0
            ? "none"
            : `${undeclared.length}: ${undeclared.join(", ")}`,
        verdict: undeclared.length === 0 ? "match" : "mismatch",
        note:
          undeclared.length === 0
            ? undefined
            : "netbox_describe cannot mention these, so a model never learns they exist, " +
              "and netbox_write rejects them locally as unknown fields if it is handed one back.",
      });

      // Read-only claims. describe.ts tells the model these are "returned by
      // GET but never accepted on write"; the first half of that is testable.
      const readOnlyDeclared = Object.entries(readSchema?.properties ?? {})
        .filter(([, prop]) => prop?.readOnly === true)
        .map(([name]) => name);
      const readOnlyAbsent = readOnlyDeclared.filter((name) => !returned.includes(name));
      observations.push({
        section: SECTION_FIELDS,
        check: `${objectType} — read-only fields are actually returned`,
        derived: `${readOnlyDeclared.length} propert(ies) marked readOnly: ${readOnlyDeclared.slice(0, 8).join(", ") || "none"}`,
        actual:
          readOnlyAbsent.length === 0
            ? "all present in the object"
            : `absent from the object: ${readOnlyAbsent.join(", ")}`,
        verdict:
          readOnlyDeclared.length === 0
            ? "unverified"
            : readOnlyAbsent.length === 0
              ? "match"
              : "mismatch",
        note:
          readOnlyAbsent.length > 0
            ? "describe's note claims these are 'returned by GET'. On this instance they are not."
            : undefined,
      });

      // Required-on-create, cross-checked against a real object.
      if (entry.summary.operations.includes("create")) {
        const described = describeObjectType(registry, entry, "create");
        const requiredNames = described.fields
          .filter((f) => f.required)
          .map((f) => f.name);
        const absent = requiredNames.filter((name) => !returned.includes(name));
        observations.push({
          section: SECTION_FIELDS,
          check: `${objectType} — required-on-create fields appear in a real object`,
          derived:
            requiredNames.length === 0
              ? "no field is required on create"
              : `required on create: ${requiredNames.join(", ")}`,
          actual: absent.length === 0 ? "all present" : `absent: ${absent.join(", ")}`,
          verdict:
            requiredNames.length === 0 ? "info" : absent.length === 0 ? "match" : "info",
          note:
            absent.length > 0
              ? "Not necessarily wrong — a write-only field is legal — but a required field " +
                "that a read never returns is worth confirming before trusting it."
              : undefined,
        });
      }
    }

    checkAll(observations);
  });

  it("returns only values the derived enums contain", () => {
    const observations: Observation[] = [];
    let checkedFields = 0;

    for (const { objectType, entry, object } of sampled) {
      if (!object) continue;
      if (!entry.summary.operations.includes("create")) continue;

      const described = describeObjectType(registry, entry, "create");
      const enumFields = described.fields.filter(
        (field): field is FieldSpec & { enum: string[] } =>
          field.enum !== undefined && field.enum.length > 0,
      );

      for (const field of enumFields) {
        const raw = object[field.name];
        if (raw === undefined || raw === null) continue;
        checkedFields += 1;

        const values = extractChoiceValues(raw);
        if (values === undefined) {
          observations.push({
            section: SECTION_ENUMS,
            check: `${objectType}.${field.name} choice shape`,
            derived:
              'a bare string on write, {"value","label"} on read (derivation §3.5)',
            actual: `${jsonType(raw)}: ${preview(raw, 100)}`,
            verdict: "info",
            note: "Neither shape. describe's choice-field note does not cover this.",
          });
          continue;
        }

        const outside = values.filter((value) => !field.enum.includes(value));
        const caseInsensitiveHits = outside.filter((value) =>
          field.enum.some((allowed) => allowed.toLowerCase() === value.toLowerCase()),
        );

        observations.push({
          section: SECTION_ENUMS,
          check: `${objectType}.${field.name}`,
          derived: `one of: ${field.enum.join(", ")}`,
          actual:
            outside.length === 0
              ? `returned ${values.map((v) => JSON.stringify(v)).join(", ")}`
              : `returned ${outside.map((v) => JSON.stringify(v)).join(", ")}, which the derived enum does not contain`,
          verdict: outside.length === 0 ? "match" : "mismatch",
          note:
            outside.length === 0
              ? undefined
              : caseInsensitiveHits.length > 0
                ? "Case difference only. validate.ts compares with `enum.includes(value)`, which " +
                  "is case-sensitive, so a model echoing this value back is refused locally " +
                  "before any request is sent."
                : "validate.ts refuses this value locally, so it cannot be written back even " +
                  "though NetBox produced it.",
        });
      }
    }

    record({
      section: SECTION_ENUMS,
      check: "enum coverage",
      derived: "every enum field on every sampled type that carried a value",
      actual: `${checkedFields} field value(s) across ${sampled.filter((s) => s.object).length} object(s)`,
      verdict: "info",
    });

    checkAll(observations);
  });
});

/**
 * Read a choice field's value(s) out of whatever shape NetBox returned.
 * Returns undefined when the value is neither a string, nor a `{value,label}`
 * object, nor an array of either.
 */
function extractChoiceValues(raw: unknown): string[] | undefined {
  if (typeof raw === "string") return [raw];
  const asObject = asRecord(raw);
  if (asObject) {
    const value = asObject["value"];
    return typeof value === "string" ? [value] : undefined;
  }
  const list = asArray(raw);
  if (list) {
    const out: string[] = [];
    for (const item of list) {
      const nested = extractChoiceValues(item);
      if (nested === undefined) return undefined;
      out.push(...nested);
    }
    return out;
  }
  return undefined;
}
