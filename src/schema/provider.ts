/**
 * The `SchemaProvider` implementation — the only thing `src/tools/` sees.
 *
 * Laziness lives here: the registry is derived on first use and the loader is
 * not touched before that. Nothing on this surface exposes the OpenAPI
 * document, and nothing may be added that does.
 */

import type { NetBoxConfig } from "../config.js";
import { describeObjectType, suggestObjectTypes } from "./describe.js";
import {
  createSchemaLoader,
  type SchemaLoader,
  type SchemaLoaderOptions,
} from "./loader.js";
import type { OpenApiDocument } from "./openapi.js";
import { buildRegistry, type SchemaRegistry } from "./registry.js";
import {
  type DescribeResult,
  type ListObjectTypesFilter,
  type ObjectTypeKey,
  type ObjectTypeSummary,
  type Operation,
  type SchemaProvider,
  UnknownObjectTypeError,
  UnsupportedOperationError,
} from "./types.js";

function matchesFilter(
  summary: ObjectTypeSummary,
  filter: ListObjectTypesFilter,
): boolean {
  if (filter.app !== undefined && filter.app.length > 0) {
    if (summary.app.toLowerCase() !== filter.app.toLowerCase()) return false;
  }
  const query = filter.query?.trim().toLowerCase();
  if (query !== undefined && query.length > 0) {
    const haystack =
      `${summary.object_type} ${summary.label} ${summary.summary} ${summary.endpoint}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

/** Build a provider over an already-parsed document. Used by tests and warm starts. */
export function createSchemaProviderFromDocument(
  document: OpenApiDocument,
): SchemaProvider {
  return providerFromRegistry(() => Promise.resolve(buildRegistry(document)));
}

export interface SchemaProviderOptions extends SchemaLoaderOptions {
  loader?: SchemaLoader;
}

/** Build a provider that fetches the connected instance's schema on first use. */
export function createSchemaProvider(options: SchemaProviderOptions): SchemaProvider {
  const loader = options.loader ?? createSchemaLoader(options);
  let registry: Promise<SchemaRegistry> | undefined;
  return providerFromRegistry(() => {
    if (!registry) {
      registry = loader
        .load()
        .then((loaded) => {
          const derived = buildRegistry(loaded.document);
          // `/api/status/` is authoritative for the version; `info.version`
          // is the fallback the document itself carries.
          return loaded.version === "unknown"
            ? derived
            : { ...derived, version: loaded.version };
        })
        .catch((error: unknown) => {
          registry = undefined;
          throw error;
        });
    }
    return registry;
  });
}

/** Convenience for the server wiring: config in, provider out. */
export function createSchemaProviderForConfig(config: NetBoxConfig): SchemaProvider {
  return createSchemaProvider({ config });
}

function providerFromRegistry(
  getRegistry: () => Promise<SchemaRegistry>,
): SchemaProvider {
  return {
    async version(): Promise<string> {
      return (await getRegistry()).version;
    },

    async listObjectTypes(
      filter: ListObjectTypesFilter = {},
    ): Promise<ObjectTypeSummary[]> {
      const registry = await getRegistry();
      return [...registry.types.values()]
        .map((entry) => entry.summary)
        .filter((summary) => matchesFilter(summary, filter))
        .sort((a, b) => a.object_type.localeCompare(b.object_type));
    },

    async resolve(objectType: ObjectTypeKey): Promise<ObjectTypeSummary | undefined> {
      const registry = await getRegistry();
      return registry.types.get(objectType)?.summary;
    },

    async describe(
      objectType: ObjectTypeKey,
      operation: Operation,
    ): Promise<DescribeResult> {
      const registry = await getRegistry();
      const entry = registry.types.get(objectType);
      if (!entry) {
        throw new UnknownObjectTypeError(
          objectType,
          suggestObjectTypes(registry, objectType),
        );
      }
      if (!entry.summary.operations.includes(operation)) {
        throw new UnsupportedOperationError(
          objectType,
          operation,
          entry.summary.operations,
        );
      }
      return describeObjectType(registry, entry, operation);
    },
  };
}
