/**
 * Layer 3 — execution, read half.
 *
 * Split from `netbox_write` so that `readOnlyHint: true` is the truth rather
 * than an average. A host that gates on annotations must be able to let every
 * call to this tool through without prompting.
 *
 * The endpoint comes from the schema provider, never from the caller.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { getClient, type PaginatedResponse } from "../../client.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../../constants.js";
import {
  buildListPayload,
  enforceCharacterLimit,
  renderListMarkdown,
  renderObjectMarkdown,
  ResponseFormat,
} from "../../formatting.js";
import { ResponseFormatField } from "../../schemas/common.js";
import type { ObjectTypeSummary, SchemaProvider } from "../../schema/types.js";
import {
  clampText,
  errorResult,
  requireOperation,
  resolveType,
  textResult,
  toErrorText,
} from "./shared.js";

/** A query-parameter name NetBox could plausibly accept. */
const FILTER_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;

const FilterValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

const Input = {
  object_type: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Object type key from netbox_discover, e.g. 'dcim.device'. Not a path and not a URL: the endpoint is resolved from the registry.",
    ),
  operation: z
    .enum(["list", "get"])
    .describe("'list' for a filtered collection, 'get' for one object by id."),
  id: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Numeric NetBox id. Required for 'get', ignored for 'list'."),
  filters: z
    .record(z.string(), FilterValue)
    .optional()
    .describe(
      "Query filters for 'list', as NetBox query-parameter names, e.g. { site: 'dc1', status: 'active', q: 'sw-core' }. Call netbox_describe(object_type, 'list') for the accepted names. An array value repeats the parameter (OR semantics for most filters).",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Page size for 'list' (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Rows to skip for 'list'. Use next_offset from a previous response."),
  response_format: ResponseFormatField,
};

const DESCRIPTION = `Reads NetBox objects: one by id, or a filtered, paginated list. Never modifies anything.

Call this AFTER netbox_discover (for the object_type) and, for anything but a trivial list, AFTER netbox_describe (for the filter names). Use netbox_write to change data. Use netbox_global_search when you do not yet know which object type a name belongs to.

Args:
  - object_type (string, required)  key from netbox_discover, e.g. 'ipam.prefix'.
  - operation   (string, required)  'list' or 'get'.
  - id          (number)            required for 'get'.
  - filters     (object)            for 'list'; NetBox query-parameter names -> values.
  - limit / offset (number)         pagination for 'list'.
  - response_format ('markdown' | 'json')  use 'json' when chaining to another call.

Returns Markdown by default, or JSON shaped { total, count, offset, limit, items, has_more, next_offset? }. Long responses are truncated and tell you the offset to resume from — paginate or filter rather than raising limit.

Note that a filter value is usually a slug or an id, not a display name: filter devices by site='dc1' (slug) or site_id=3, not site='DC 1'.`;

export function registerRead(server: McpServer, schema: SchemaProvider): void {
  server.registerTool(
    "netbox_read",
    {
      title: "Read NetBox Objects",
      description: DESCRIPTION,
      inputSchema: Input,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const summary = await resolveType(schema, args.object_type);
        requireOperation(summary, args.operation);
        return args.operation === "get"
          ? await runGet(summary, args)
          : await runList(summary, args);
      } catch (error) {
        return errorResult(toErrorText(error));
      }
    },
  );
}

interface ReadArgs {
  operation: "list" | "get";
  id?: number | undefined;
  filters?:
    Record<string, string | number | boolean | (string | number | boolean)[]> | undefined;
  limit: number;
  offset: number;
  response_format: ResponseFormat;
}

async function runGet(
  summary: ObjectTypeSummary,
  args: ReadArgs,
): Promise<CallToolResult> {
  if (args.id === undefined) {
    return errorResult(
      `Error: 'get' needs an 'id'. Either supply the numeric id of the ${summary.label}, ` +
        `or call netbox_read with operation='list' (optionally with filters) to find it.`,
    );
  }
  const object = await getClient().get<Record<string, unknown>>(
    summary.endpoint,
    args.id,
  );
  if (args.response_format === ResponseFormat.JSON) {
    return textResult(clampText(JSON.stringify(object, null, 2)), {
      object_type: summary.object_type,
      item: object,
    });
  }
  return textResult(clampText(renderObjectMarkdown(object)), {
    object_type: summary.object_type,
    item: object,
  });
}

async function runList(
  summary: ObjectTypeSummary,
  args: ReadArgs,
): Promise<CallToolResult> {
  const filters = args.filters ?? {};
  const badKeys = Object.keys(filters).filter((k) => !FILTER_KEY.test(k));
  if (badKeys.length > 0) {
    return errorResult(
      `Error: not a NetBox filter name: ${badKeys.map((k) => `"${k}"`).join(", ")}. ` +
        `Call netbox_describe with object_type="${summary.object_type}" and operation="list" for the accepted filters.`,
    );
  }

  let response: PaginatedResponse<Record<string, unknown>>;
  try {
    response = await getClient().list<Record<string, unknown>>(summary.endpoint, {
      ...filters,
      limit: args.limit,
      offset: args.offset,
    });
  } catch (error) {
    return errorResult(
      `${toErrorText(error)}\nIf a filter name is the problem, call netbox_describe with ` +
        `object_type="${summary.object_type}" and operation="list" for the accepted filters.`,
    );
  }

  const payload = buildListPayload(
    response.results,
    response.count,
    args.limit,
    args.offset,
  );
  const title = `${summary.label} (${summary.object_type})`;
  const renderer = (items: Record<string, unknown>[]): string =>
    renderListMarkdown(items, {
      title,
      total: response.count,
      offset: args.offset,
    });

  if (args.response_format === ResponseFormat.JSON) {
    const jsonRenderer = (items: Record<string, unknown>[]): string =>
      JSON.stringify({ ...payload, count: items.length, items }, null, 2);
    const bounded = enforceCharacterLimit(
      jsonRenderer(payload.items),
      payload,
      jsonRenderer,
    );
    return textResult(bounded.text, {
      object_type: summary.object_type,
      ...bounded.payload,
    });
  }

  const bounded = enforceCharacterLimit(renderer(payload.items), payload, renderer);
  return textResult(bounded.text, {
    object_type: summary.object_type,
    ...bounded.payload,
  });
}
