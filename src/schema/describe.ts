/**
 * Layer 2: derive a `DescribeResult` for one object type and one operation.
 *
 * Three things here are the difference between a description a model can act
 * on and one that wastes a context window:
 *
 *  - Fields come from the WRITE component, resolved by `$ref` (registry.ts).
 *    Read components carry `id`, `url`, `created` and nine `*_count` fields in
 *    their `required` array; presenting those as inputs tells an agent it must
 *    supply an id to create a device (§3.2, §11).
 *  - Foreign keys become `refersTo` + `acceptsId`, which is what produces
 *    `dependsOn` — the answer to "what must exist before I can create this".
 *  - Filters are SUMMARISED. `dcim/devices` has 342 query parameters and 72.5%
 *    of them are `__`-suffixed lookup variants of the other 27.5%. Those are
 *    replaced by one sentence in `filterGrammar` (§4.3).
 */

import type {
  Deprecation,
  DescribeResult,
  FieldSpec,
  FilterSpec,
  ObjectTypeKey,
  Operation,
} from "./types.js";
import { deprecationNote, deprecationsFor, type FieldPresence } from "./deprecations.js";
import {
  deref,
  getComponent,
  type JsonSchemaNode,
  type OperationObject,
  type ParameterObject,
  refName,
} from "./openapi.js";
import {
  type RegistryEntry,
  type SchemaRegistry,
  patchSchemaOf,
  readSchemaOf,
  resolveBriefTarget,
  writeSchemaOf,
} from "./registry.js";

/** Filters every list endpoint has, surfaced first because they always apply. */
const CONTROL_FILTERS = [
  "q",
  "id",
  "limit",
  "offset",
  "ordering",
  "brief",
  "fields",
  "omit",
];

/**
 * The one sentence that replaces ~248 parameters on `dcim/devices`. `__regex`,
 * `__iregex` and `__any` are real and were missed by the first recon pass.
 */
export const FILTER_GRAMMAR =
  "Lookup-suffix variants of these filters are omitted. Append a suffix to any filter name: " +
  "`__n` negates any filter; string filters also take `__ic`/`__nic` (contains), " +
  "`__isw`/`__nisw` (starts with), `__iew`/`__niew` (ends with), `__ie`/`__nie` " +
  "(case-insensitive exact), `__empty`, `__regex`/`__iregex`; numeric and date filters " +
  "also take `__lt`/`__lte`/`__gt`/`__gte`; a few multi-value filters take `__any`. " +
  "For example `name__ic=core` or `created__gte=2026-01-01`.";

/**
 * The `brief` parameter is truthiness-tested as a RAW STRING, so every value
 * that is not empty turns brief mode ON — `brief=0` and `brief=false` included,
 * because `'0'` and `'false'` are truthy Python strings.
 *
 *   netbox/netbox/api/viewsets/__init__.py:
 *     self.brief = request.method == 'GET' and request.GET.get('brief')
 *
 * This is a SOURCE-LEVEL observation against 4.6.8, not documented behaviour —
 * nothing in the REST API docs says it and it could change without a release
 * note. It is not a deprecation and it is not per-type, which is why it lives
 * here as a plain note on `list` rather than in the deprecation table.
 */
export const BRIEF_TRUTHINESS_NOTE =
  "Do NOT send brief=0 or brief=false to turn brief mode OFF: NetBox tests the raw " +
  'string for truthiness, so ANY non-empty value — including the string "false" — ' +
  "ENABLES it and you get truncated objects that look like whole ones. Omit the " +
  "parameter entirely for full objects.";

const MAX_DESCRIPTION_CHARS = 200;
const MAX_READONLY_NAMES = 12;

/** Collapse drf-spectacular's multi-line enum glossary onto one line. */
export function compactDescription(description: string | undefined): string | undefined {
  if (description === undefined) return undefined;
  const flat = description.replace(/\s*\n\s*/g, " ").trim();
  if (flat.length === 0) return undefined;
  if (flat.length <= MAX_DESCRIPTION_CHARS) return flat;
  return `${flat.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`;
}

function stringEnum(node: JsonSchemaNode | undefined): string[] | undefined {
  const values = node?.enum;
  if (!values || values.length === 0) return undefined;
  const strings = values.filter((v): v is string => typeof v === "string");
  return strings.length > 0 ? strings : undefined;
}

function mapType(node: JsonSchemaNode | undefined): FieldSpec["type"] {
  switch (node?.type) {
    case "string":
      return "string";
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      if (node?.enum) return "string";
      if (node?.properties) return "object";
      if (node?.items) return "array";
      return "unknown";
  }
}

interface ForeignKeyShape {
  /** Component name of the target, e.g. `BriefSiteRequest`. */
  component: string;
  acceptsId: boolean;
  toMany: boolean;
}

/** `{"$ref": ".../BriefSiteRequest"}` possibly wrapped in `allOf` + `nullable`. */
function refFromMember(node: JsonSchemaNode | undefined): string | undefined {
  if (!node) return undefined;
  const direct = refName(node.$ref);
  if (direct) return direct;
  const wrapped = node.allOf?.[0];
  return refName(wrapped?.$ref);
}

/**
 * Detect a foreign key.
 *
 * NetBox >= 4.4 writes `oneOf: [{type: integer}, Brief<X>Request]` — 1329 such
 * properties, none bare. Instances on <= 4.3 emit the nested-object-only form,
 * so both shapes are handled; the runtime accepts an integer PK either way,
 * which is what NetBox's own docs promise.
 */
export function detectForeignKey(prop: JsonSchemaNode): ForeignKeyShape | undefined {
  if (prop.oneOf && prop.oneOf.length > 0) {
    const hasInteger = prop.oneOf.some((member) => member.type === "integer");
    for (const member of prop.oneOf) {
      const component = refFromMember(member);
      if (component) return { component, acceptsId: hasInteger, toMany: false };
    }
    return undefined;
  }
  if (prop.type === "array" || prop.items) {
    const component = refFromMember(prop.items);
    if (component) return { component, acceptsId: true, toMany: true };
    return undefined;
  }
  const bare = refFromMember(prop);
  // A bare `$ref` to a Brief*/Nested* component is the legacy (<= 4.3) FK form.
  if (bare && /^(?:Brief|Nested)/.test(bare)) {
    return { component: bare, acceptsId: true, toMany: false };
  }
  return undefined;
}

function isNullable(prop: JsonSchemaNode): boolean {
  if (prop.nullable === true) return true;
  return prop.oneOf?.some((member) => member.nullable === true) === true;
}

function fieldFrom(
  registry: SchemaRegistry,
  app: string,
  name: string,
  rawProp: JsonSchemaNode,
  required: boolean,
): FieldSpec {
  // Detect the FK on the RAW property: the legacy (<= 4.3) form is a bare
  // `$ref` to a Brief component, and dereferencing it first would dissolve the
  // relation into an anonymous nested object.
  const fk = detectForeignKey(rawProp);
  const prop = fk ? rawProp : (deref(registry.document, rawProp) ?? rawProp);
  const readOnly = prop.readOnly === true;
  const nullable = isNullable(prop);

  if (fk) {
    const refersTo = resolveBriefTarget(registry, fk.component, app);
    const target =
      refersTo ?? fk.component.replace(/^(?:Brief|Nested)/, "").replace(/Request$/, "");
    const relation = fk.toMany ? "references many" : "references";
    const supplied = fk.acceptsId
      ? `${fk.toMany ? "a list of numeric IDs" : "a numeric ID"} (preferred) or a nested object`
      : "a nested object";
    return {
      name,
      type: fk.toMany ? "array" : "integer",
      required,
      readOnly,
      nullable,
      description: [
        compactDescription(prop.description),
        `${relation} ${target}; accepts ${supplied}`,
      ]
        .filter((part): part is string => part !== undefined)
        .join(" — "),
      enum: undefined,
      refersTo,
      acceptsId: fk.acceptsId,
    };
  }

  return {
    name,
    type: mapType(prop),
    required,
    readOnly,
    nullable,
    description: compactDescription(prop.description ?? prop.title),
    enum: stringEnum(prop),
    refersTo: undefined,
    acceptsId: undefined,
  };
}

/**
 * Turn a write component into a field list.
 *
 * `readOnly` properties are marked and never reported as required. Stock 4.6.7
 * strips them from `*Request` components entirely, so this filter is a no-op
 * there — but it is not a no-op for a plugin serializer or an older instance,
 * and `required` on a *response* component genuinely does list `id`.
 */
export function fieldsFromSchema(
  registry: SchemaRegistry,
  schema: JsonSchemaNode | undefined,
  app: string,
  options: { forceOptional?: boolean } = {},
): FieldSpec[] {
  if (!schema?.properties) return [];
  const required = new Set(schema.required ?? []);
  const fields: FieldSpec[] = [];
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (!prop) continue;
    const readOnly = prop.readOnly === true;
    const isRequired = !options.forceOptional && required.has(name) && !readOnly;
    fields.push(fieldFrom(registry, app, name, prop, isRequired));
  }
  return fields;
}

function readOnlyFieldNames(registry: SchemaRegistry, entry: RegistryEntry): string[] {
  const read = readSchemaOf(registry, entry);
  if (!read?.properties) return [];
  return Object.entries(read.properties)
    .filter(([, prop]) => prop?.readOnly === true)
    .map(([name]) => name);
}

function dependsOnFrom(fields: FieldSpec[]): ObjectTypeKey[] {
  const targets = new Set<ObjectTypeKey>();
  for (const field of fields) {
    if (field.refersTo !== undefined) targets.add(field.refersTo);
  }
  return [...targets].sort();
}

function filterType(schema: JsonSchemaNode | undefined): string {
  if (!schema) return "unknown";
  if (schema.type === "array") {
    const itemType = schema.items?.type;
    return itemType ? `array of ${itemType}` : "array";
  }
  return schema.type ?? "unknown";
}

function filterDescription(param: ParameterObject): string | undefined {
  const values = stringEnum(param.schema);
  if (values) {
    return `one of: ${values.filter((v) => v !== "null").join(", ")}`;
  }
  return compactDescription(param.description);
}

/**
 * Summarise a list endpoint's query parameters.
 *
 * Everything with a `__` lookup suffix is dropped in favour of `filterGrammar`.
 * The `_id` forms have no suffix, so they survive — and they are the ones layer
 * 3 chains from a previous create.
 */
export function summariseFilters(
  operation: OperationObject | undefined,
  rank: { requiredFields: string[] },
): { filters: FilterSpec[]; elided: number; all: string[] } {
  const parameters = (operation?.parameters ?? []).filter(
    (param) => param.in === "query" && typeof param.name === "string",
  );
  const base: ParameterObject[] = [];
  const all: string[] = [];
  let elided = 0;
  for (const param of parameters) {
    if (param.name !== undefined) all.push(param.name);
    if (param.name !== undefined && param.name.includes("__")) {
      elided += 1;
      continue;
    }
    base.push(param);
  }

  const requiredFields = new Set(rank.requiredFields);
  const priority = (name: string): number => {
    if (CONTROL_FILTERS.includes(name)) return 0;
    if (requiredFields.has(name) || requiredFields.has(name.replace(/_id$/, "")))
      return 1;
    if (name.endsWith("_id")) return 2;
    return 3;
  };

  const filters = base
    .map((param) => ({ param, name: param.name ?? "" }))
    .sort((a, b) => {
      const byPriority = priority(a.name) - priority(b.name);
      if (byPriority !== 0) return byPriority;
      if (priority(a.name) === 0) {
        return CONTROL_FILTERS.indexOf(a.name) - CONTROL_FILTERS.indexOf(b.name);
      }
      return a.name.localeCompare(b.name);
    })
    .map(({ param, name }): FilterSpec => {
      const description = filterDescription(param);
      return description === undefined
        ? { name, type: filterType(param.schema) }
        : { name, type: filterType(param.schema), description };
    });

  return { filters, elided, all };
}

function choiceFieldNote(fields: FieldSpec[]): string | undefined {
  if (!fields.some((field) => field.enum !== undefined)) return undefined;
  return (
    "Choice fields take a bare value string on write. A GET returns them as " +
    '{"value", "label"} — send the value, not the object.'
  );
}

function readOnlyNote(names: string[]): string | undefined {
  if (names.length === 0) return undefined;
  const shown = names.slice(0, MAX_READONLY_NAMES);
  const suffix =
    names.length > shown.length ? `, +${names.length - shown.length} more` : "";
  return `Read-only, returned by GET but never accepted on write: ${shown.join(", ")}${suffix}.`;
}

/**
 * Attach the hand-maintained deprecation table to a derived description.
 *
 * The notes go FIRST. A deprecation is the one thing in a describe result that
 * changes what the caller should do rather than how, and a note buried under
 * "Read-only, returned by GET but never accepted on write: ..." is a note that
 * did not get read.
 *
 * This ADDS information and nothing else: no field is removed, no operation is
 * withdrawn, no request is refused. See `deprecations.ts`.
 */
function withDeprecations(result: DescribeResult): DescribeResult {
  const deprecations = deprecationsFor(result.object_type, result.operation);
  if (deprecations.length === 0) return result;

  // A removal note is checked against THIS instance rather than asserted from
  // the table. `dcim.module.local_context_data` is why: the table says NetBox
  // removed it in 4.6.3, and a live 4.6.0 — which the table's own wording
  // claimed would still accept it — does not carry the field at all.
  const declared = new Set(result.fields.map((field) => field.name));
  const presenceOf = (deprecation: Deprecation): FieldPresence => {
    if (deprecation.target === deprecation.objectType) return "unknown";
    if (result.fields.length === 0) return "unknown";
    const field = deprecation.target.slice(deprecation.objectType.length + 1);
    return declared.has(field) ? "present" : "absent";
  };

  return {
    ...result,
    deprecations,
    notes: [
      ...deprecations.map((d) => deprecationNote(d, presenceOf(d))),
      ...result.notes,
    ],
  };
}

/** Derive the description of one operation on one object type. */
export function describeObjectType(
  registry: SchemaRegistry,
  entry: RegistryEntry,
  operation: Operation,
): DescribeResult {
  return withDeprecations(deriveDescription(registry, entry, operation));
}

function deriveDescription(
  registry: SchemaRegistry,
  entry: RegistryEntry,
  operation: Operation,
): DescribeResult {
  const { summary } = entry;
  const base: DescribeResult = {
    object_type: summary.object_type,
    operation,
    endpoint: summary.endpoint,
    fields: [],
    filters: undefined,
    filterGrammar: undefined,
    dependsOn: [],
    notes: [],
  };

  if (operation === "create" || operation === "update") {
    const isUpdate = operation === "update";
    const schema = isUpdate
      ? (patchSchemaOf(registry, entry) ?? writeSchemaOf(registry, entry))
      : writeSchemaOf(registry, entry);
    const usedPatch = isUpdate && patchSchemaOf(registry, entry) !== undefined;
    const fields = fieldsFromSchema(registry, schema, summary.app, {
      forceOptional: isUpdate,
    });
    const notes: string[] = [];

    if (!schema) {
      notes.push(
        `The instance's schema does not describe a request body for ${operation} on ` +
          `${summary.endpoint}; its fields cannot be derived. Consult the NetBox API docs ` +
          `for this endpoint.`,
      );
    }
    if (isUpdate) {
      notes.push(
        usedPatch
          ? `PATCH ${summary.endpoint}/{id}/ is partial: send only the fields you are changing.`
          : `PUT ${summary.endpoint}/{id}/ replaces the object: send the full field set.`,
      );
    } else {
      const required = fields
        .filter((field) => field.required)
        .map((field) => field.name);
      notes.push(
        required.length > 0
          ? `Required on create: ${required.join(", ")}.`
          : "No field is required on create; NetBox model defaults apply.",
      );
    }
    if (fields.some((field) => field.acceptsId === true)) {
      notes.push(
        "Related objects are referenced by numeric ID. Create or look up the referenced " +
          "object first and pass its id.",
      );
    }
    const choice = choiceFieldNote(fields);
    if (choice) notes.push(choice);
    const readOnly = readOnlyNote(readOnlyFieldNames(registry, entry));
    if (readOnly) notes.push(readOnly);

    return { ...base, fields, dependsOn: dependsOnFrom(fields), notes };
  }

  if (operation === "list") {
    const writeSchema = writeSchemaOf(registry, entry);
    const { filters, elided, all } = summariseFilters(entry.collection.get, {
      requiredFields: writeSchema?.required ?? [],
    });
    const notes = [
      `${filters.length} filters shown; ${elided} lookup-suffix variants elided.`,
      "Results are paginated: use limit and offset, and brief=true for a compact form.",
      BRIEF_TRUTHINESS_NOTE,
    ];
    if (filters.some((filter) => filter.name === "q")) {
      notes.push("q is a free-text search across the type's searchable fields.");
    }
    return {
      ...base,
      filters,
      // The elided names still have to reach the validator: `filters` is what
      // a model is shown, `filterNames` is what a call is checked against.
      filterNames: all,
      filterGrammar: FILTER_GRAMMAR,
      notes,
    };
  }

  if (operation === "get") {
    return {
      ...base,
      notes: [
        `GET ${summary.endpoint}/{id}/ returns one object by numeric ID.`,
        'Choice fields come back as {"value", "label"} objects and related objects as ' +
          "nested briefs; write operations take the bare value and the numeric ID.",
      ],
    };
  }

  return {
    ...base,
    notes: [
      `DELETE ${summary.endpoint}/{id}/ removes one object by numeric ID.`,
      "NetBox cascades or refuses depending on the relation; deletion cannot be undone.",
    ],
  };
}

/** Exposed for the provider's "did you mean" hint. */
export function suggestObjectTypes(
  registry: SchemaRegistry,
  query: string,
  limit = 5,
): ObjectTypeKey[] {
  const needle = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (needle.length === 0) return [];
  const scored: { key: ObjectTypeKey; score: number }[] = [];
  for (const [key, entry] of registry.types) {
    const haystack = `${key} ${entry.summary.label}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (haystack.includes(needle)) {
      scored.push({ key, score: Math.abs(haystack.length - needle.length) });
    } else if (needle.length > 3 && haystack.includes(needle.slice(0, 4))) {
      scored.push({ key, score: 100 + Math.abs(haystack.length - needle.length) });
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((item) => item.key);
}

/** Kept next to the derivation so a new component name cannot bypass it. */
export function isWriteSchemaResolvable(entry: RegistryEntry): boolean {
  return entry.writeSchemaName !== undefined;
}

/** Resolve a component by name — for diagnostics and tests only, never for derivation. */
export function componentByName(
  registry: SchemaRegistry,
  name: string,
): JsonSchemaNode | undefined {
  return getComponent(registry.document, name);
}
