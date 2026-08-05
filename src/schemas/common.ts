/**
 * Shared Zod schemas used across list/get/create/update tools.
 */

import { z } from "zod";

import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";
import { ResponseFormat } from "../formatting.js";

/** Response format shared by every read tool. */
export const ResponseFormatField = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe(
    "Output format: 'markdown' (default, human-readable) or 'json' (full structured payload). Use 'json' when chaining follow-up tool calls.",
  );

/** Pagination fields shared by every list tool. */
export const PaginationSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(
      `Maximum number of items to return per page (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "Number of items to skip for pagination. Use next_offset from a previous response.",
    ),
});

/** Generic filter fields shared by most NetBox list endpoints. */
export const CommonListFilters = z.object({
  q: z
    .string()
    .optional()
    .describe(
      "Fuzzy full-text search across the object's searchable fields (name, description, etc.).",
    ),
  tag: z
    .array(z.string())
    .optional()
    .describe(
      "Filter to objects that have ALL of these tag slugs. Repeat for multiple tags (AND semantics in NetBox).",
    ),
  created_after: z
    .string()
    .optional()
    .describe(
      "ISO-8601 date; only return objects created on or after this date (e.g. 2024-01-01).",
    ),
  created_before: z
    .string()
    .optional()
    .describe("ISO-8601 date; only return objects created on or before this date."),
});

/** Get-by-id schema shared by every get tool. */
export const GetByIdSchema = z.object({
  id: z.number().int().min(1).describe("Numeric object ID in NetBox."),
  response_format: ResponseFormatField,
});

/** `custom_fields` is a free-form dict on almost every NetBox object. */
export const CustomFieldsSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    "Optional object of custom-field slugs -> values. Only include fields defined on your NetBox instance.",
  );

/** Shared "tags" field for writes: array of tag slugs. */
export const TagSlugsSchema = z
  .array(z.string())
  .optional()
  .describe("Optional array of tag slugs to apply to the object.");
