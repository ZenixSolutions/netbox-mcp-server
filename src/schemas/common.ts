/**
 * Zod fragments shared by the layered tools.
 *
 * What remains here after the tool-surface rewrite is only what more than one
 * tool needs. Per-resource filter and body shapes are gone: those are now
 * derived from the instance's own OpenAPI document at runtime, in
 * `src/schema/`, rather than hand-written and left to drift.
 */

import { z } from "zod";

import { ResponseFormat } from "../formatting.js";

export const ResponseFormatField = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe(
    "'markdown' (default) for a compact human-readable summary, 'json' for the " +
      "full NetBox object. Prefer markdown unless you need a field the summary omits.",
  );
