/**
 * Local validation of a write payload against the layer-2 schema.
 *
 * The whole point is that a wrong `data` object never leaves the process. A
 * NetBox 400 costs a round-trip, tells the model only what NetBox chose to
 * echo, and — per RFC-003 S2 — echoes back whatever was submitted. Checking
 * here is cheaper, more specific, and cannot leak.
 */

import type { DescribeResult, FieldSpec } from "../../schema/types.js";
import { writableFields } from "./shared.js";

export interface ValidationOutcome {
  ok: boolean;
  errors: string[];
}

/**
 * @param data      What the caller wants to send.
 * @param described The layer-2 description for this object type + operation.
 * @param mode      `create` enforces required fields; `update` is a PATCH and
 *                  deliberately does not — sending only the changed fields is
 *                  the correct way to use it.
 */
export function validateWriteData(
  data: Record<string, unknown>,
  described: DescribeResult,
  mode: "create" | "update",
): ValidationOutcome {
  const errors: string[] = [];
  const all = described.fields;
  const writable = writableFields(all);
  const byName = new Map(all.map((f) => [f.name, f]));
  const writableNames = writable.map((f) => f.name);

  for (const [key, value] of Object.entries(data)) {
    const field = byName.get(key);
    if (!field) {
      errors.push(
        `Unknown field \`${key}\`. This object type accepts: ${writableNames.join(", ") || "(no writable fields)"}.`,
      );
      continue;
    }
    if (field.readOnly) {
      errors.push(
        `Field \`${key}\` is read-only — NetBox computes it. Remove it from \`data\`.`,
      );
      continue;
    }
    errors.push(...checkValue(field, value));
  }

  if (mode === "create") {
    for (const field of writable) {
      if (!field.required) continue;
      const value = data[field.name];
      if (value === undefined || value === null || value === "") {
        errors.push(
          `Missing required field \`${field.name}\` (${field.type})` +
            (field.refersTo ? `, a reference to ${field.refersTo}` : "") +
            ".",
        );
      }
    }
  }

  if (mode === "update" && Object.keys(data).length === 0) {
    errors.push("`data` is empty — an update must name at least one field to change.");
  }

  return { ok: errors.length === 0, errors };
}

function checkValue(field: FieldSpec, value: unknown): string[] {
  if (value === null) {
    return field.nullable === false
      ? [`Field \`${field.name}\` is not nullable — omit it instead of sending null.`]
      : [];
  }

  if (field.enum && field.enum.length > 0) {
    if (typeof value !== "string" || !field.enum.includes(value)) {
      return [
        `Field \`${field.name}\` must be one of: ${field.enum.join(", ")}. ` +
          `Received ${describeValue(value)}.`,
      ];
    }
    return [];
  }

  switch (field.type) {
    case "string":
      return typeof value === "string" ? [] : [typeError(field, "a string", value)];
    case "integer":
      return isReference(field, value) ||
        (typeof value === "number" && Number.isInteger(value))
        ? []
        : [typeError(field, referenceHint(field) ?? "an integer", value)];
    case "number":
      return isReference(field, value) || typeof value === "number"
        ? []
        : [typeError(field, referenceHint(field) ?? "a number", value)];
    case "boolean":
      return typeof value === "boolean" ? [] : [typeError(field, "true or false", value)];
    case "array":
      return Array.isArray(value) ? [] : [typeError(field, "an array", value)];
    case "object":
      return typeof value === "object" && !Array.isArray(value)
        ? []
        : [typeError(field, "an object", value)];
    case "unknown":
      return [];
    default:
      return [];
  }
}

/**
 * NetBox writes a foreign key as `oneOf: [integer, Brief<X>Request]`, so an
 * object is as valid as an id wherever `refersTo` is set.
 */
function isReference(field: FieldSpec, value: unknown): boolean {
  return (
    field.refersTo !== undefined &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function referenceHint(field: FieldSpec): string | undefined {
  return field.refersTo
    ? `the numeric id of a ${field.refersTo} (or an object identifying one)`
    : undefined;
}

function typeError(field: FieldSpec, expected: string, value: unknown): string {
  return `Field \`${field.name}\` must be ${expected}. Received ${describeValue(value)}.`;
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array of ${value.length} item(s)`;
  if (typeof value === "object") return "an object";
  if (typeof value === "string") return `the string "${truncate(value)}"`;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return `the ${typeof value} ${truncate(String(value))}`;
  }
  return `a value of type ${typeof value}`;
}

function truncate(value: string): string {
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}
