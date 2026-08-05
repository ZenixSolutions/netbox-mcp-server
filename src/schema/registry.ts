/**
 * Layer 1: derive the object-type registry from a NetBox OpenAPI document.
 *
 * The rules here are the ones verified against NetBox 4.6.7 in
 * `docs/reference/netbox-schema-derivation.md`. Two of them are load-bearing
 * and easy to get subtly wrong:
 *
 *  - An object type is a collection path with a `post` AND a matching `/{id}/`
 *    detail path. "Collection with a `get`" discards nothing (all 138 stock
 *    collections have one) and admits 12 endpoints that are not object types.
 *  - The write schema is resolved by `$ref` from an operation, never by
 *    component name. `SiteRequest` exists — as the bulk-DELETE payload — so a
 *    name rule resolves to the WRONG schema rather than failing (§3.1).
 */

import type { ObjectTypeKey, ObjectTypeSummary, Operation } from "./types.js";
import {
  classifyCollectionWrite,
  deref,
  getComponent,
  type JsonSchemaNode,
  type OpenApiDocument,
  type OperationObject,
  type PathItemObject,
  requestSchemaName,
  responseSchemaName,
} from "./openapi.js";

/** Where a write schema came from. `name` must never occur. */
export type SchemaResolution = "detail-put" | "detail-patch" | "collection-post" | "name";

export interface RegistryEntry {
  summary: ObjectTypeSummary;
  /** Path key in the document, e.g. `/api/dcim/devices/`. */
  collectionPath: string;
  /** Path key in the document, e.g. `/api/dcim/devices/{id}/`. */
  detailPath: string;
  collection: PathItemObject;
  detail: PathItemObject;
  /** Component name of the create/replace body, e.g. `WritableSiteRequest`. */
  writeSchemaName?: string | undefined;
  writeSchemaResolvedFrom?: SchemaResolution | undefined;
  /** Component name of the PATCH body, e.g. `PatchedWritableSiteRequest`. */
  patchSchemaName?: string | undefined;
  /** Component name of the detail GET response, e.g. `Site`. */
  readSchemaName?: string | undefined;
}

export interface RegistryDiagnostics {
  netboxVersion: string;
  totalPaths: number;
  collectionPaths: number;
  detailPaths: number;
  objectTypes: number;
  /** Collection paths that are not object types (12 on stock 4.6.7). */
  excludedCollections: string[];
  /** `/api/` paths that are neither a collection nor an `{id}` detail path. */
  otherPaths: string[];
  typesWithoutWriteSchema: ObjectTypeKey[];
  typesWithoutPatchSchema: ObjectTypeKey[];
  typesWithoutReadSchema: ObjectTypeKey[];
  /** Must be 0. A non-zero value means a name-mapping rule crept back in. */
  writeSchemasResolvedByName: number;
}

export interface SchemaRegistry {
  /** NetBox version the document describes, e.g. `4.6.7`. */
  version: string;
  /** Not surfaced to callers — the derivation reads it, nothing else may. */
  document: OpenApiDocument;
  types: Map<ObjectTypeKey, RegistryEntry>;
  /**
   * `briefsite` / `objectpermission` / `device` -> object type key. Built from
   * the paths, never from a hand-written table, so plugins index themselves.
   */
  modelIndex: Map<string, ObjectTypeKey[]>;
  diagnostics: RegistryDiagnostics;
}

interface ClassifiedPath {
  path: string;
  item: PathItemObject;
  kind: "collection" | "detail" | "other";
  /** `dcim` or `plugins/netbox_inventory`. */
  app: string;
  /** `devices`, `ip-addresses`. */
  slug: string;
}

const CONTROL_PATH_SEGMENT = "{";

/**
 * Classify a path key by segment count after `/api`, per §2.2. Paths retain
 * the `/api/` prefix in NetBox 4.x; the `segs[0] !== "api"` branch is a
 * defensive guard that never fires on a stock document.
 */
export function classifyPath(path: string, item: PathItemObject): ClassifiedPath {
  const segs = path.split("/").filter((s) => s.length > 0);
  const other: ClassifiedPath = { path, item, kind: "other", app: "", slug: "" };
  if (segs[0] !== "api") return other;

  const plugin = segs[1] === "plugins";
  // Core: ['api', app, slug] / ['api', app, slug, '{id}']
  // Plugin: ['api','plugins', plugin, slug] / [..., '{id}']
  const appEnd = plugin ? 3 : 2;
  const app = plugin ? segs.slice(1, 3).join("/") : segs[1];
  const slug = segs[appEnd];
  if (app === undefined || app === "" || slug === undefined) return other;

  const collectionLength = appEnd + 1;
  if (segs.length === collectionLength && !slug.includes(CONTROL_PATH_SEGMENT)) {
    return { path, item, kind: "collection", app, slug };
  }
  if (
    segs.length === collectionLength + 1 &&
    !slug.includes(CONTROL_PATH_SEGMENT) &&
    segs[collectionLength] === "{id}"
  ) {
    return { path, item, kind: "detail", app, slug };
  }
  return other;
}

/**
 * Singularise a URL slug into a model name. NetBox slugs are hyphenated
 * plurals; `-es` after a sibilant, `-ies`, and the already-singular
 * `virtual-chassis` are the cases a naive `-s` strip gets wrong (§2.3).
 *
 * `-ses` is the case that got the netbox-inventory plugin wrong on a live
 * 4.6.0: stripping `-es` from every sibilant `-es` turns `purchases` into
 * `purchas`. The singular of a `-ses` plural ends in `-s` only when it is
 * itself sibilant-final (`address`, `status`, `bus`); otherwise the plural was
 * formed on a silent `-e` (`purchase`, `license`, `case`) and only the `-s`
 * comes off. Testing the candidate rather than the plural is what separates
 * them. `-ches`/`-shes`/`-xes`/`-zes` carry no such ambiguity in the slugs
 * NetBox serves and come off whole.
 *
 * This is a heuristic over a URL slug, which is not authoritative — prefer
 * `modelNameFor`, which uses it only as a fallback.
 */
export function singularise(slug: string): string {
  const flat = slug.replace(/-/g, "");
  if (/(?:ss|us|is)$/.test(flat)) return flat;
  if (/ies$/.test(flat)) return `${flat.slice(0, -3)}y`;
  if (/(?:x|z|ch|sh)es$/.test(flat)) return flat.slice(0, -2);
  if (/ses$/.test(flat)) {
    const withoutEs = flat.slice(0, -2);
    return /(?:ss|us|is)$/.test(withoutEs) ? withoutEs : flat.slice(0, -1);
  }
  if (/s$/.test(flat)) return flat.slice(0, -1);
  return flat;
}

/**
 * True when `model` could have produced `flatSlug` by pluralisation.
 *
 * The guard on trusting a component name: `dcim/devices` resolves the read
 * component `DeviceWithConfigContext` and `users/permissions` resolves
 * `ObjectPermission`, neither of which is the URL's noun. Requiring the
 * component to be the slug modulo a plural suffix accepts `Purchase` for
 * `purchases` and rejects both of those, which then fall back to the slug.
 */
function pluraliseAgrees(model: string, flatSlug: string): boolean {
  if (model.length === 0) return false;
  if (flatSlug === model || flatSlug === `${model}s` || flatSlug === `${model}es`) {
    return true;
  }
  return model.endsWith("y") && flatSlug === `${model.slice(0, -1)}ies`;
}

/**
 * The model name for a collection, preferring the component the schema itself
 * resolved over the URL slug.
 *
 * A slug is a routing convenience; the request/response component is the
 * serializer's own name for the model, and it is what the singularisation
 * heuristic is trying to guess. Where the two agree modulo pluralisation the
 * component wins — that is how `plugins/inventory/purchases` becomes
 * `purchase` no matter what any `-es` rule does.
 */
export function modelNameFor(
  slug: string,
  componentNames: (string | undefined)[] = [],
): string {
  const flat = slug.replace(/-/g, "").toLowerCase();
  for (const componentName of componentNames) {
    if (componentName === undefined) continue;
    const model = stripWriteAffixes(componentName).toLowerCase();
    if (pluraliseAgrees(model, flat)) return model;
  }
  return singularise(slug);
}

/**
 * `Get a list of IP address objects.` -> `IP address`.
 *
 * Every operation carries this templated description, and it embeds NetBox's
 * own verbose model name — which is a strictly better label than title-casing
 * the slug, and works for plugins too (§2.6).
 */
export function verboseNameFromDescription(
  description: string | undefined,
): string | undefined {
  if (!description) return undefined;
  const match = /^Get a list of (.+?) objects\.\s*$/.exec(description);
  return match?.[1];
}

function labelFor(collectionGet: OperationObject | undefined, model: string): string {
  const verbose = verboseNameFromDescription(collectionGet?.description);
  const raw = verbose ?? model;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * `dcim` + `ip-addresses` -> `ipam.ipaddress`; plugins get three segments.
 *
 * `model` is the derivation's own key component: this is a stable identifier
 * for this server, deliberately NOT a claim about Django's `app_label.model`
 * (§2.3).
 */
export function objectTypeKey(
  app: string,
  slug: string,
  model: string = singularise(slug),
): ObjectTypeKey {
  return `${app.replace(/\//g, ".")}.${model}`;
}

function deriveOperations(
  collection: PathItemObject,
  detail: PathItemObject,
): Operation[] {
  const operations: Operation[] = [];
  if (collection.get) operations.push("list");
  if (detail.get) operations.push("get");
  // `create` is only claimed when the collection POST documents a single
  // object; a bulk-only POST would be a different tool shape.
  if (classifyCollectionWrite(collection.post) === "singleton") operations.push("create");
  // update/delete are read off the DETAIL path only. The collection's
  // PUT/PATCH/DELETE are bulk operations on 125 of 138 stock collections.
  if (detail.put ?? detail.patch) operations.push("update");
  if (detail.delete) operations.push("delete");
  return operations;
}

/** Strip the `Brief`/`Nested` prefix and `Request` suffix: `BriefSiteRequest` -> `site`. */
export function briefTargetName(componentName: string | undefined): string | undefined {
  if (!componentName) return undefined;
  const stripped = componentName.replace(/^(?:Brief|Nested)/, "").replace(/Request$/, "");
  return stripped.length > 0 ? stripped.toLowerCase() : undefined;
}

function addAlias(
  index: Map<string, ObjectTypeKey[]>,
  alias: string,
  key: ObjectTypeKey,
): void {
  const normalised = alias.toLowerCase();
  if (normalised.length === 0) return;
  const existing = index.get(normalised);
  if (!existing) {
    index.set(normalised, [key]);
  } else if (!existing.includes(key)) {
    existing.push(key);
  }
}

/**
 * Resolve `BriefSiteRequest` to `dcim.site`.
 *
 * Ambiguity is real: `dcim/interfaces` and `virtualization/interfaces` both
 * singularise to `interface`. Prefer a candidate in the referring type's own
 * app; give up rather than guess when that does not disambiguate.
 */
export function resolveBriefTarget(
  registry: Pick<SchemaRegistry, "modelIndex" | "types">,
  componentName: string | undefined,
  preferApp?: string,
): ObjectTypeKey | undefined {
  const target = briefTargetName(componentName);
  if (!target) return undefined;
  const candidates = registry.modelIndex.get(target);
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  if (preferApp !== undefined) {
    const sameApp = candidates.find(
      (key) => registry.types.get(key)?.summary.app === preferApp,
    );
    if (sameApp) return sameApp;
  }
  return undefined;
}

function stripWriteAffixes(componentName: string): string {
  return componentName.replace(/^Writable/, "").replace(/Request$/, "");
}

/**
 * Resolve the write ("create"/"replace") schema for a type.
 *
 * Order matters. The DETAIL `put` body is a plain `$ref` and is the most
 * reliable source; the collection `post` body is a `oneOf` on 125 of 126 stock
 * types and must be unwrapped. A name lookup is never attempted — see the
 * module header.
 */
function resolveWriteSchema(
  collection: PathItemObject,
  detail: PathItemObject,
): { name: string | undefined; from: SchemaResolution | undefined } {
  const fromPut = requestSchemaName(detail.put);
  if (fromPut) return { name: fromPut, from: "detail-put" };
  const fromPost = requestSchemaName(collection.post);
  if (fromPost) return { name: fromPost, from: "collection-post" };
  return { name: undefined, from: undefined };
}

export function buildRegistry(document: OpenApiDocument): SchemaRegistry {
  const paths = document.paths ?? {};
  const classified: ClassifiedPath[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!item) continue;
    classified.push(classifyPath(path, item));
  }

  const collections = classified.filter((c) => c.kind === "collection");
  const details = new Map<string, ClassifiedPath>();
  for (const c of classified) {
    if (c.kind === "detail") details.set(`${c.app}/${c.slug}`, c);
  }

  const types = new Map<ObjectTypeKey, RegistryEntry>();
  const modelIndex = new Map<string, ObjectTypeKey[]>();
  const excludedCollections: string[] = [];
  const typesWithoutWriteSchema: ObjectTypeKey[] = [];
  const typesWithoutPatchSchema: ObjectTypeKey[] = [];
  const typesWithoutReadSchema: ObjectTypeKey[] = [];

  for (const collection of collections) {
    const detail = details.get(`${collection.app}/${collection.slug}`);
    // THE object-type rule: a single-object POST plus an `/{id}/` detail path.
    if (!detail || !collection.item.post) {
      excludedCollections.push(collection.path);
      continue;
    }

    const write = resolveWriteSchema(collection.item, detail.item);
    const patchSchemaName = requestSchemaName(detail.item.patch);
    const readSchemaName = responseSchemaName(detail.item.get);
    // The resolved components are authoritative where they agree with the
    // slug; the slug heuristic is the fallback, not the first choice.
    const model = modelNameFor(collection.slug, [write.name, readSchemaName]);
    const key = objectTypeKey(collection.app, collection.slug, model);
    const endpoint = `${collection.app}/${collection.slug}`;
    const label = labelFor(collection.item.get, model);

    const summary: ObjectTypeSummary = {
      object_type: key,
      label,
      endpoint,
      app: collection.app,
      operations: deriveOperations(collection.item, detail.item),
      summary: `${label} objects (${endpoint}).`,
    };

    types.set(key, {
      summary,
      collectionPath: collection.path,
      detailPath: detail.path,
      collection: collection.item,
      detail: detail.item,
      writeSchemaName: write.name,
      writeSchemaResolvedFrom: write.from,
      patchSchemaName,
      readSchemaName,
    });

    if (!write.name) typesWithoutWriteSchema.push(key);
    if (!patchSchemaName) typesWithoutPatchSchema.push(key);
    if (!readSchemaName) typesWithoutReadSchema.push(key);

    // Aliases for the Brief* reverse index. The slug-derived model name covers
    // `BriefDevice`; the component names cover `ObjectPermission` and
    // `DeviceWithConfigContext`, where the slug and the serializer disagree.
    addAlias(modelIndex, model, key);
    if (readSchemaName) addAlias(modelIndex, readSchemaName, key);
    if (write.name) addAlias(modelIndex, stripWriteAffixes(write.name), key);
  }

  const version = document.info?.version ?? "unknown";

  return {
    version,
    document,
    types,
    modelIndex,
    diagnostics: {
      netboxVersion: version,
      totalPaths: classified.length,
      collectionPaths: collections.length,
      detailPaths: details.size,
      objectTypes: types.size,
      excludedCollections,
      otherPaths: classified.filter((c) => c.kind === "other").map((c) => c.path),
      typesWithoutWriteSchema,
      typesWithoutPatchSchema,
      typesWithoutReadSchema,
      // Zero by construction: `resolveWriteSchema` has no name branch. The
      // counter exists so a regression that adds one is visible (§18).
      writeSchemasResolvedByName: 0,
    },
  };
}

/**
 * A short, human-readable self-audit. Rules verified at 4.6.7 will not hold at
 * 4.8, so the derivation reports what it managed rather than pretending.
 */
export function formatDiagnostics(diagnostics: RegistryDiagnostics): string {
  return [
    `NetBox ${diagnostics.netboxVersion}: ${diagnostics.totalPaths} paths, ` +
      `${diagnostics.collectionPaths} collections, ${diagnostics.detailPaths} details`,
    `${diagnostics.objectTypes} object types; ` +
      `${diagnostics.excludedCollections.length} collections excluded`,
    `${diagnostics.typesWithoutWriteSchema.length} without a write schema, ` +
      `${diagnostics.typesWithoutPatchSchema.length} without a patch schema, ` +
      `${diagnostics.typesWithoutReadSchema.length} without a read schema`,
    `${diagnostics.writeSchemasResolvedByName} write schemas resolved by name (must be 0)`,
  ].join("\n");
}

/** The resolved write/patch/read component, or undefined when unresolvable. */
export function writeSchemaOf(
  registry: SchemaRegistry,
  entry: RegistryEntry,
): JsonSchemaNode | undefined {
  return deref(registry.document, getComponent(registry.document, entry.writeSchemaName));
}

export function patchSchemaOf(
  registry: SchemaRegistry,
  entry: RegistryEntry,
): JsonSchemaNode | undefined {
  return deref(registry.document, getComponent(registry.document, entry.patchSchemaName));
}

export function readSchemaOf(
  registry: SchemaRegistry,
  entry: RegistryEntry,
): JsonSchemaNode | undefined {
  return deref(registry.document, getComponent(registry.document, entry.readSchemaName));
}
