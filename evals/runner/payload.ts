/**
 * Build a write payload from nothing but a `netbox_describe` response.
 *
 * This is the interesting part of the dependency-ordering task. A model that
 * has called `netbox_describe(dcim.device, "create")` has exactly this
 * information and nothing else: a list of required fields, each with a type
 * and — for a foreign key — the object type it refers to. If a valid payload
 * cannot be assembled from that, the planning layer has failed at the one job
 * it exists to do, and no amount of prompt engineering fixes it.
 *
 * So the payload is assembled mechanically from the describe output, never
 * from hand-written knowledge of NetBox's field names.
 */

import { asArray, asRecord, asString } from "../../tests/contract/http.js";
import type { Fixtures, ToolCall } from "../types.js";

export interface AssembledPayload {
  data: Record<string, unknown>;
  /** Required fields no fixture could satisfy. Non-empty means "cannot run". */
  unmet: string[];
}

/** Ids the assembler can supply, keyed by the object type a field refers to. */
function referenceIds(fixtures: Fixtures): Map<string, number> {
  const map = new Map<string, number>();
  const add = (type: string, id: number | undefined): void => {
    if (id !== undefined) map.set(type, id);
  };
  add("dcim.site", fixtures.site?.id);
  add("dcim.rack", fixtures.rack?.id);
  add("dcim.device", fixtures.device?.id);
  add("dcim.devicetype", fixtures.deviceType?.id);
  add("dcim.devicerole", fixtures.deviceRole?.id);
  add("dcim.interface", fixtures.deviceInterface?.id);
  return map;
}

interface DescribedField {
  name: string;
  type: string;
  refersTo: string | undefined;
  enumValues: string[];
}

function fieldsFrom(call: ToolCall, key: string): DescribedField[] {
  return (asArray(call.structured?.[key]) ?? []).flatMap((entry) => {
    const record = asRecord(entry);
    const name = asString(record?.["name"]);
    if (record === undefined || name === undefined) return [];
    return [
      {
        name,
        type: asString(record["type"]) ?? "unknown",
        refersTo: asString(record["refersTo"]),
        enumValues: (asArray(record["enum"]) ?? []).flatMap((value) => {
          const text = asString(value);
          return text === undefined ? [] : [text];
        }),
      },
    ];
  });
}

/**
 * Assemble `data` for a create, using only what `netbox_describe` returned.
 *
 * `extra` is merged last: it is the part a user's request supplies (a name,
 * an address), which no schema can invent.
 */
export function payloadFromDescribe(
  describeCall: ToolCall,
  fixtures: Fixtures,
  extra: Record<string, unknown> = {},
): AssembledPayload {
  const ids = referenceIds(fixtures);
  const data: Record<string, unknown> = {};
  const unmet: string[] = [];

  for (const field of fieldsFrom(describeCall, "required_fields")) {
    if (field.refersTo !== undefined) {
      const id = ids.get(field.refersTo);
      if (id === undefined) {
        unmet.push(
          `${field.name} -> ${field.refersTo} (no such object on this instance)`,
        );
        continue;
      }
      data[field.name] = id;
      continue;
    }
    if (field.enumValues.length > 0) {
      data[field.name] = field.enumValues[0];
      continue;
    }
    switch (field.type) {
      case "string":
        data[field.name] = "eval-probe";
        break;
      case "integer":
      case "number":
        data[field.name] = 1;
        break;
      case "boolean":
        data[field.name] = false;
        break;
      case "array":
        data[field.name] = [];
        break;
      case "object":
        data[field.name] = {};
        break;
      default:
        unmet.push(
          `${field.name} (type "${field.type}" — describe gives no usable value)`,
        );
    }
  }

  return { data: { ...data, ...extra }, unmet };
}
