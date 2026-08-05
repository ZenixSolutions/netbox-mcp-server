/**
 * Assertions a task's steps are written in.
 *
 * Each returns `null` when the result is what the task requires, or a sentence
 * naming what was wrong. They are deliberately about the *response a model
 * would see* — its text and its structured payload — rather than about
 * internals, because the response is the whole of what a model has to work
 * with. If a check cannot be written against the response, it is not a check
 * this suite can make, and the task should say so.
 */

import { asArray, asNumber, asRecord } from "../../tests/contract/http.js";
import type { ToolCall } from "../types.js";

/** The call must have succeeded. */
export function succeeded(call: ToolCall): string | null {
  return call.isError ? `expected success, got an error: ${firstLine(call.text)}` : null;
}

/** The call must have been refused — by the server, not by NetBox. */
export function failed(call: ToolCall): string | null {
  return call.isError ? null : `expected a refusal, but the call succeeded`;
}

/** Every fragment must appear in the response text, case-insensitively. */
export function mentions(call: ToolCall, ...fragments: string[]): string | null {
  const haystack = call.text.toLowerCase();
  const missing = fragments.filter(
    (fragment) => !haystack.includes(fragment.toLowerCase()),
  );
  return missing.length === 0
    ? null
    : `response does not mention ${missing.map((m) => `"${m}"`).join(", ")}`;
}

/** No fragment may appear in the response text. */
export function omits(call: ToolCall, ...fragments: string[]): string | null {
  const haystack = call.text.toLowerCase();
  const present = fragments.filter((fragment) =>
    haystack.includes(fragment.toLowerCase()),
  );
  return present.length === 0
    ? null
    : `response mentions ${present.map((m) => `"${m}"`).join(", ")}, which it should not`;
}

/** A `netbox_read` list response must carry a numeric `total`. */
export function hasTotal(call: ToolCall): string | null {
  return asNumber(call.structured?.["total"]) === undefined
    ? "response carries no numeric `total`; a count question cannot be answered from it"
    : null;
}

/** `netbox_describe` must have advertised these object types as prerequisites. */
export function dependsOn(call: ToolCall, ...expected: string[]): string | null {
  const declared = (asArray(call.structured?.["depends_on"]) ?? []).map(String);
  const missing = expected.filter((type) => !declared.includes(type));
  return missing.length === 0
    ? null
    : `\`depends_on\` is [${declared.join(", ")}] and omits ${missing.join(", ")}`;
}

/** `netbox_describe` must have named these fields, required or optional. */
export function describesFields(call: ToolCall, ...names: string[]): string | null {
  const known = new Set(
    [
      ...(asArray(call.structured?.["required_fields"]) ?? []),
      ...(asArray(call.structured?.["optional_fields"]) ?? []),
    ]
      .map((field) => asRecord(field)?.["name"])
      .filter((name): name is string => typeof name === "string"),
  );
  const missing = names.filter((name) => !known.has(name));
  return missing.length === 0
    ? null
    : `describe does not offer field(s) ${missing.join(", ")}; a model cannot supply what it is not told about`;
}

/** `netbox_describe(list)` must have advertised these filter names. */
export function describesFilters(call: ToolCall, ...names: string[]): string | null {
  const known = new Set(
    (asArray(call.structured?.["filters"]) ?? [])
      .map((filter) => asRecord(filter)?.["name"])
      .filter((name): name is string => typeof name === "string"),
  );
  const missing = names.filter((name) => !known.has(name));
  return missing.length === 0
    ? null
    : `the summarised filter list omits ${missing.join(", ")}`;
}

/** Combine checks; the first complaint wins. */
export function all(...results: (string | null)[]): string | null {
  return results.find((result) => result !== null) ?? null;
}

export function firstLine(text: string): string {
  return (text.split("\n").find((line) => line.trim().length > 0) ?? "").slice(0, 200);
}
