/**
 * The contract between the schema layer and the tool layer.
 *
 * This file is the seam. `src/schema/` produces a `SchemaProvider` from a
 * NetBox OpenAPI document; `src/tools/` consumes one and knows nothing about
 * OpenAPI. Neither side may reach past it.
 *
 * Everything here is derived at runtime from the connected instance's own
 * `/api/schema/`, which is what makes the layered design defensible: the
 * planning layer cannot drift from the instance the way a hand-written tool
 * schema can. See `docs/reference/netbox-schema-derivation.md` for the rules
 * and, more importantly, for the four assumptions that turned out to be wrong.
 */

/** Stable identifier for a NetBox object type, e.g. `dcim.device`. */
export type ObjectTypeKey = string;

export type Operation = "list" | "get" | "create" | "update" | "delete";

export interface ObjectTypeSummary {
  /** e.g. `dcim.device` */
  object_type: ObjectTypeKey;
  /** Human label, e.g. "Device". */
  label: string;
  /** API endpoint with no leading or trailing slash, e.g. `dcim/devices`. */
  endpoint: string;
  /** App label, e.g. `dcim`. Plugins use `plugins/<plugin>`. */
  app: string;
  /**
   * Operations this type genuinely supports as a SINGLE-object action.
   *
   * Derived from a `post` on the collection plus a matching `/{id}/` detail
   * path — NOT from the set of HTTP methods present. 125 of 138 collection
   * paths carry bulk PUT/PATCH/DELETE, and advertising those as `update` or
   * `delete` would offer a single-object verb that acts on many.
   */
  operations: Operation[];
  /** One line, for the discovery layer. */
  summary: string;
}

export interface FieldSpec {
  name: string;
  type: "string" | "integer" | "number" | "boolean" | "array" | "object" | "unknown";
  required: boolean;
  readOnly: boolean;
  nullable?: boolean | undefined;
  description?: string | undefined;
  /** Exact allowed values, when the field is an enum. */
  enum?: string[] | undefined;
  /**
   * For a foreign key, the object type it points at — this is what tells an
   * agent that a site must exist before a device can be created.
   */
  refersTo?: ObjectTypeKey | undefined;
  /**
   * True when a bare integer primary key is accepted as well as an object.
   * NetBox expresses FKs as `oneOf: [integer, Brief<X>Request]`.
   */
  acceptsId?: boolean | undefined;
}

export interface FilterSpec {
  name: string;
  type: string;
  description?: string | undefined;
}

export interface DescribeResult {
  object_type: ObjectTypeKey;
  operation: Operation;
  endpoint: string;
  /** Populated for create and update. Empty for list, get and delete. */
  fields: FieldSpec[];
  /**
   * Populated for list. SUMMARISED, not exhaustive: `dcim/devices` accepts
   * 342 query parameters and 72.5% of them are `__`-suffixed lookup variants.
   * Returning all of them is not usable by a model.
   */
  filters?: FilterSpec[] | undefined;
  /** One sentence describing the `__` lookup-suffix grammar that was elided. */
  filterGrammar?: string | undefined;
  /** Object types that must exist before this one can be created. */
  dependsOn: ObjectTypeKey[];
  /** Anything the caller must know that the field list cannot express. */
  notes: string[];
}

export interface ListObjectTypesFilter {
  /** Restrict to one app, e.g. `dcim`. */
  app?: string | undefined;
  /** Free-text match against object_type, label and summary. */
  query?: string | undefined;
}

/**
 * Everything the tool layer is allowed to know about the connected instance.
 *
 * Implementations must be lazy: a session that only lists devices should not
 * pay to fetch and parse a multi-megabyte schema document.
 */
export interface SchemaProvider {
  /** NetBox version the loaded document describes, e.g. "4.6.7". */
  version(): Promise<string>;

  listObjectTypes(filter?: ListObjectTypesFilter): Promise<ObjectTypeSummary[]>;

  /** Undefined when the key is not a known object type. */
  resolve(objectType: ObjectTypeKey): Promise<ObjectTypeSummary | undefined>;

  describe(objectType: ObjectTypeKey, operation: Operation): Promise<DescribeResult>;
}

/** Thrown when a caller names an object type that does not exist. */
export class UnknownObjectTypeError extends Error {
  constructor(
    readonly objectType: string,
    readonly suggestions: ObjectTypeKey[] = [],
  ) {
    const hint =
      suggestions.length > 0
        ? ` Did you mean: ${suggestions.join(", ")}?`
        : " Call netbox_discover to list the object types this instance supports.";
    super(`Unknown object type "${objectType}".${hint}`);
    this.name = "UnknownObjectTypeError";
  }
}

/** Thrown when an operation is not supported for an object type. */
export class UnsupportedOperationError extends Error {
  constructor(
    readonly objectType: ObjectTypeKey,
    readonly operation: Operation,
    readonly supported: Operation[],
  ) {
    super(
      `Object type "${objectType}" does not support "${operation}". ` +
        `Supported: ${supported.join(", ") || "none"}.`,
    );
    this.name = "UnsupportedOperationError";
  }
}
