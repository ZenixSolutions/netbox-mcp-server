/**
 * The schema layer's public surface.
 *
 * `src/tools/` should import from here and from `./types.js` only. The parsed
 * OpenAPI document is not exported and must not become exported: it is 6-13 MB
 * and belongs nowhere near a tool result.
 */

export * from "./types.js";
export {
  createSchemaProvider,
  createSchemaProviderForConfig,
  createSchemaProviderFromDocument,
  type SchemaProviderOptions,
} from "./provider.js";
export {
  createSchemaLoader,
  defaultCacheDir,
  SchemaUnavailableError,
  type HttpGet,
  type HttpResponse,
  type LoadedSchema,
  type SchemaLoader,
  type SchemaLoaderOptions,
} from "./loader.js";
export { BRIEF_TRUTHINESS_NOTE, FILTER_GRAMMAR } from "./describe.js";
export {
  DEPRECATIONS,
  deprecationNote,
  deprecationsFor,
  VERIFIED_AGAINST,
} from "./deprecations.js";
export {
  buildRegistry,
  formatDiagnostics,
  type RegistryDiagnostics,
  type RegistryEntry,
  type SchemaRegistry,
} from "./registry.js";
