/**
 * Tool factories.
 *
 * Each NetBox resource exposes some combination of list/get/create/update. The
 * functions here register a matching MCP tool given the resource's endpoint,
 * display name, and per-resource Zod schemas. This is the main mechanism for
 * keeping duplicate code out of this codebase.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodRawShape } from "zod";

import { getClient } from "./client.js";
import { isReadOnly } from "./gating.js";
import { handleApiError } from "./errors.js";
import {
  buildListPayload,
  enforceCharacterLimit,
  ListPayload,
  renderListMarkdown,
  renderObjectMarkdown,
  ResponseFormat,
  toDisplayString,
} from "./formatting.js";
import {
  CommonListFilters,
  GetByIdSchema,
  PaginationSchema,
  ResponseFormatField,
} from "./schemas/common.js";

interface ResourceDescriptor {
  /** NetBox API endpoint without leading/trailing slash, e.g. "dcim/sites". */
  endpoint: string;
  /** Singular resource label, e.g. "site". */
  singular: string;
  /** Plural resource label, e.g. "sites". */
  plural: string;
  /** Short description used in list/get tool descriptions. */
  description: string;
  /** Fields to surface in the Markdown listing. Optional. */
  listFields?: string[] | undefined;
  /** Fields to surface in the Markdown detail view. Optional. */
  detailFields?: string[] | undefined;
}

/**
 * Register a list tool for a resource.
 *
 *   netbox_list_<plural>
 *
 * `extraFilters` should be a Zod-raw-shape keyed by NetBox query-parameter
 * names. CommonListFilters + pagination + response_format are always added.
 */
export function registerList<Extra extends ZodRawShape>(
  server: McpServer,
  resource: ResourceDescriptor,
  extraFilters: Extra,
): void {
  const inputShape = {
    ...CommonListFilters.shape,
    ...PaginationSchema.shape,
    response_format: ResponseFormatField,
    ...extraFilters,
  };

  const toolName = `netbox_list_${resource.plural}`;
  const title = `List ${capitalize(resource.plural)}`;
  const filterDocs = renderFilterDocs(extraFilters);

  const description = `List ${resource.description} from NetBox.

Supports pagination and filtering. Common patterns:
  - Discovery:    call with no filters to browse the first ${resource.plural}.
  - Lookup by id: use netbox_get_${resource.singular} instead when you already have an id.
  - Narrow scan:  combine 'q' (fuzzy text) with resource-specific filters below.

Pagination:
  - 'limit' (max 1000, default 50) and 'offset'. Response includes 'has_more' and 'next_offset'.
  - Large list responses auto-truncate to keep under the character limit; keep calling with next_offset to continue.

Resource-specific filters:
${filterDocs || "  (none)"}

Universal filters:
  - q (string)            Fuzzy text search across searchable fields.
  - tag (string[])        AND-filter by tag slugs.
  - created_after  (date) ISO-8601 lower bound on 'created'.
  - created_before (date) ISO-8601 upper bound on 'created'.

Returns:
  Markdown summary (default) or JSON with shape:
    { total, count, offset, limit, items: [...], has_more, next_offset? }
`;

  (server.registerTool as (...a: unknown[]) => unknown)(
    toolName,
    {
      title,
      description,
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any, _extra: any): Promise<CallToolResult> => {
      try {
        const {
          response_format = ResponseFormat.MARKDOWN,
          limit = 50,
          offset = 0,
          tag,
          ...rest
        } = args as {
          response_format?: ResponseFormat;
          limit?: number;
          offset?: number;
          tag?: string[];
          [k: string]: unknown;
        };
        const data = await getClient().list<Record<string, unknown>>(resource.endpoint, {
          ...rest,
          tag,
          limit,
          offset,
        });
        const payload = buildListPayload<Record<string, unknown>>(
          data.results,
          data.count,
          limit,
          offset,
        );
        return formatListResult(payload, response_format, resource);
      } catch (error) {
        return asError(handleApiError(error));
      }
    },
  );
}

/** Register a get-by-id tool. */
export function registerGet(server: McpServer, resource: ResourceDescriptor): void {
  const toolName = `netbox_get_${resource.singular}`;
  const description = `Get a single ${resource.singular} from NetBox by numeric id.

Use after netbox_list_${resource.plural} has located the object, or when you already have the id.

Returns:
  Markdown detail (default) or JSON with the full NetBox object including nested references.
`;
  (server.registerTool as (...a: unknown[]) => unknown)(
    toolName,
    {
      title: `Get ${capitalize(resource.singular)}`,
      description,
      inputSchema: GetByIdSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any, _extra: any): Promise<CallToolResult> => {
      try {
        const id = args.id as number;
        const response_format = (args.response_format ??
          ResponseFormat.MARKDOWN) as ResponseFormat;
        const obj = await getClient().get<Record<string, unknown>>(resource.endpoint, id);
        return formatDetailResult(obj, response_format, resource);
      } catch (error) {
        return asError(handleApiError(error));
      }
    },
  );
}

/**
 * Register a create tool for a resource. `bodyShape` is a Zod-raw-shape
 * describing the accepted fields.
 */
export function registerCreate<Body extends ZodRawShape>(
  server: McpServer,
  resource: ResourceDescriptor,
  bodyShape: Body,
  opts: { descriptionExtra?: string } = {},
): void {
  // Write tools are omitted entirely when NETBOX_READONLY is set.
  if (isReadOnly()) return;

  const inputShape = {
    ...bodyShape,
    response_format: ResponseFormatField,
  };

  const toolName = `netbox_create_${resource.singular}`;
  const description = `Create a new ${resource.singular} in NetBox.

This adds a new row to NetBox. Ask before calling if the user wanted a dry-run.${
    opts.descriptionExtra ? `\n\n${opts.descriptionExtra}` : ""
  }

Returns:
  Markdown summary of the newly created object (default) or JSON with the full NetBox response.
`;

  (server.registerTool as (...a: unknown[]) => unknown)(
    toolName,
    {
      title: `Create ${capitalize(resource.singular)}`,
      description,
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any, _extra: any): Promise<CallToolResult> => {
      try {
        const response_format = (args.response_format ??
          ResponseFormat.MARKDOWN) as ResponseFormat;
        const body = { ...args };
        delete body.response_format;
        remapReservedArgs(body);
        const obj = await getClient().create<Record<string, unknown>>(
          resource.endpoint,
          body,
        );
        return formatDetailResult(obj, response_format, resource, {
          titlePrefix: "Created",
        });
      } catch (error) {
        return asError(handleApiError(error));
      }
    },
  );
}

/**
 * Register an update (PATCH) tool for a resource. The body is merged onto the
 * existing object; only fields the caller provides are changed.
 */
export function registerUpdate<Body extends ZodRawShape>(
  server: McpServer,
  resource: ResourceDescriptor,
  bodyShape: Body,
): void {
  // Write tools are omitted entirely when NETBOX_READONLY is set.
  if (isReadOnly()) return;

  const inputShape = {
    id: z
      .number()
      .int()
      .min(1)
      .describe(`Numeric id of the ${resource.singular} to update.`),
    ...bodyShape,
    response_format: ResponseFormatField,
  };

  const toolName = `netbox_update_${resource.singular}`;
  const description = `Update an existing ${resource.singular} in NetBox (PATCH semantics — only provided fields are changed).

Supply the numeric 'id' and only the fields you want to change. Omitting a field leaves it unchanged.

Returns:
  Markdown summary of the updated object (default) or JSON with the full NetBox response.
`;

  (server.registerTool as (...a: unknown[]) => unknown)(
    toolName,
    {
      title: `Update ${capitalize(resource.singular)}`,
      description,
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any, _extra: any): Promise<CallToolResult> => {
      try {
        const id = args.id as number;
        const response_format = (args.response_format ??
          ResponseFormat.MARKDOWN) as ResponseFormat;
        const body = { ...args };
        delete body.id;
        delete body.response_format;
        remapReservedArgs(body);
        const obj = await getClient().update<Record<string, unknown>>(
          resource.endpoint,
          id,
          body,
        );
        return formatDetailResult(obj, response_format, resource, {
          titlePrefix: "Updated",
        });
      } catch (error) {
        return asError(handleApiError(error));
      }
    },
  );
}

/**
 * Register a delete tool for a resource. Deletes are destructive and NetBox
 * cascades them, so the description leans hard on confirming first.
 */
export function registerDelete(
  server: McpServer,
  resource: { endpoint: string; singular: string },
): void {
  // Write tools are omitted entirely when NETBOX_READONLY is set.
  if (isReadOnly()) return;

  const toolName = `netbox_delete_${resource.singular}`;
  const description = `Delete a ${resource.singular} from NetBox by numeric id.

DESTRUCTIVE and IRREVERSIBLE. NetBox CASCADES deletes: removing an object also
removes everything that depends on it (deleting a device removes its interfaces,
power ports, and assigned IPs; deleting a site can remove its racks, devices, and
prefixes; deleting a manufacturer removes its device types; and so on). There is
no undo. Confirm the exact object — and what will cascade with it — with the user
before calling.

Returns a confirmation on success (NetBox replies HTTP 204 No Content).`;
  (server.registerTool as (...a: unknown[]) => unknown)(
    toolName,
    {
      title: `Delete ${capitalize(resource.singular)}`,
      description,
      inputSchema: {
        id: z
          .number()
          .int()
          .min(1)
          .describe(`Numeric id of the ${resource.singular} to delete.`),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any, _extra: any): Promise<CallToolResult> => {
      try {
        const id = args.id as number;
        await getClient().del(resource.endpoint, id);
        return {
          content: [
            {
              type: "text" as const,
              text: `Deleted ${resource.singular} id ${id} from NetBox.`,
            },
          ],
        };
      } catch (error) {
        return asError(handleApiError(error));
      }
    },
  );
}

/* ---------------- shared result helpers ---------------- */

function formatListResult(
  payload: ListPayload<Record<string, unknown>>,
  format: ResponseFormat,
  resource: ResourceDescriptor,
): CallToolResult {
  const title = `NetBox ${resource.plural}`;
  const renderer = (items: Record<string, unknown>[]) =>
    renderListMarkdown(items, {
      title,
      total: payload.total,
      offset: payload.offset,
      fields: resource.listFields,
    });

  if (format === ResponseFormat.JSON) {
    const text = JSON.stringify(payload, null, 2);
    if (text.length > 25000) {
      const half = Math.max(1, Math.floor(payload.items.length / 2));
      const trimmed: ListPayload<Record<string, unknown>> = {
        ...payload,
        count: half,
        items: payload.items.slice(0, half),
        has_more: true,
        next_offset: payload.offset + half,
      };
      const note = `// Response truncated from ${payload.items.length} to ${half} items. Re-call with offset=${trimmed.next_offset}.\n`;
      return {
        content: [
          { type: "text" as const, text: note + JSON.stringify(trimmed, null, 2) },
        ],
        structuredContent: trimmed as unknown as Record<string, unknown>,
      };
    }
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: payload as unknown as Record<string, unknown>,
    };
  }

  const initial = renderer(payload.items);
  const { text, payload: finalPayload } = enforceCharacterLimit(
    initial,
    payload,
    renderer,
  );
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: finalPayload as unknown as Record<string, unknown>,
  };
}

function formatDetailResult(
  obj: Record<string, unknown>,
  format: ResponseFormat,
  resource: ResourceDescriptor,
  opts: { titlePrefix?: string } = {},
): CallToolResult {
  if (format === ResponseFormat.JSON) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
      structuredContent: obj,
    };
  }
  const name = toDisplayString(
    obj.display ??
      obj.name ??
      obj.slug ??
      obj.address ??
      obj.prefix ??
      `#${toDisplayString(obj.id)}`,
  );
  const title =
    (opts.titlePrefix
      ? `${opts.titlePrefix} ${resource.singular}: `
      : `${capitalize(resource.singular)}: `) + name;
  const text = renderObjectMarkdown(obj, {
    title,
    fields: resource.detailFields,
  });
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: obj,
  };
}

function asError(text: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text" as const, text }],
  };
}

/**
 * Map bridge-safe argument names back to the NetBox API field names before a
 * write. The Anthropic remote-devices bridge reserves the top-level argument
 * name "device" for its own device-routing and strips it before the call
 * reaches this server, so any tool that attaches an object to a device exposes
 * "device_id" instead. NetBox's REST API still expects the field to be named
 * "device", so we rename it here. Harmless for tools that use neither name.
 */
function remapReservedArgs(body: Record<string, unknown>): void {
  if (body.device_id !== undefined && body.device === undefined) {
    body.device = body.device_id;
  }
  delete body.device_id;
}

function capitalize(s: string): string {
  const first = s[0];
  if (first === undefined) return s;
  return first.toUpperCase() + s.slice(1);
}

function renderFilterDocs(shape: ZodRawShape): string {
  const lines: string[] = [];
  for (const [name, schema] of Object.entries(shape)) {
    const desc = schema.description ?? "";
    lines.push(`  - ${name}: ${desc}`);
  }
  return lines.join("\n");
}
