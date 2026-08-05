/**
 * Layer 1 — discovery.
 *
 * Returns the object-type registry of the *connected* instance, one line per
 * type, including whatever plugins it has installed. Nothing here talks to the
 * NetBox REST API with intent; it is pure metadata derived from the instance's
 * own schema.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { CHARACTER_LIMIT } from "../../constants.js";
import { buildListPayload } from "../../formatting.js";
import type { ObjectTypeSummary, SchemaProvider } from "../../schema/types.js";
import { errorResult, textResult, toErrorText } from "./shared.js";

const Input = {
  query: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Free-text match against the object type key, label and summary, e.g. 'vlan', 'power', 'circuit'. Omit to list everything.",
    ),
  app: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Restrict to one NetBox app: dcim, ipam, virtualization, circuits, tenancy, vpn, wireless, extras, users, core, or 'plugins/<name>' for a plugin.",
    ),
};

const DESCRIPTION = `START HERE. Lists the NetBox object types this instance actually supports — devices, racks, prefixes, VLANs, tenants, circuits, plugin models — with the operations each one allows.

NetBox is an infrastructure source of truth: it records sites, racks, hardware, interfaces, cabling, IP addresses and the relationships between them. Every other tool in this server is addressed by an \`object_type\` key (for example \`dcim.device\`, \`ipam.prefix\`), and this tool is where those keys come from. Do not guess one.

Layer order — follow it in this order:
  1. netbox_discover  (this tool)  find the object_type you need.
  2. netbox_describe               find the fields, filters and prerequisites for that type.
  3. netbox_read / netbox_write    do the work.
Use netbox_global_search instead when you already know the object type is irrelevant and you just want to find a named thing ("the switch called sw-core-01").

Args:
  - query (string, optional)  free-text filter over key, label and summary.
  - app   (string, optional)  restrict to one app, e.g. 'dcim'.

Returns one line per type: object_type, label, endpoint, and the operations it supports. An operation missing from that list is not offered as a single-object action and calling it will be refused.`;

export function registerDiscover(server: McpServer, schema: SchemaProvider): void {
  server.registerTool(
    "netbox_discover",
    {
      title: "Discover NetBox Object Types",
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
        const types = await schema.listObjectTypes({
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.app === undefined ? {} : { app: args.app }),
        });

        if (types.length === 0) {
          return textResult(
            `No object type matches ${describeFilter(args)}. ` +
              "Call netbox_discover again with a broader query, or with no arguments to see the whole registry.",
            { total: 0, count: 0, items: [] },
          );
        }

        const version = await safeVersion(schema);
        const shown = fitToBudget(types, args);
        const payload = buildListPayload(shown.map(toRow), types.length, shown.length, 0);
        return textResult(render(shown, types.length, version, args), {
          ...payload,
          netbox_version: version,
        });
      } catch (error) {
        return errorResult(toErrorText(error));
      }
    },
  );
}

interface DiscoverArgs {
  query?: string | undefined;
  app?: string | undefined;
}

function describeFilter(args: DiscoverArgs): string {
  const parts: string[] = [];
  if (args.query !== undefined) parts.push(`query="${args.query}"`);
  if (args.app !== undefined) parts.push(`app="${args.app}"`);
  return parts.length > 0 ? parts.join(" and ") : "the empty filter";
}

async function safeVersion(schema: SchemaProvider): Promise<string> {
  try {
    return await schema.version();
  } catch {
    return "unknown";
  }
}

function toRow(t: ObjectTypeSummary): Record<string, unknown> {
  return {
    object_type: t.object_type,
    label: t.label,
    endpoint: t.endpoint,
    app: t.app,
    operations: t.operations,
    summary: t.summary,
  };
}

function line(t: ObjectTypeSummary): string {
  return `- \`${t.object_type}\` — ${t.label} [${t.operations.join(",")}] — ${t.summary}`;
}

/**
 * Drop trailing entries until the rendering fits the response budget. Discover
 * takes no offset (it is a registry, not a data set), so the way to see the
 * rest is a narrower `query` or `app`, and the message says exactly that.
 */
function fitToBudget(
  types: ObjectTypeSummary[],
  args: DiscoverArgs,
): ObjectTypeSummary[] {
  let shown = types;
  while (
    shown.length > 1 &&
    render(shown, types.length, "x", args).length > CHARACTER_LIMIT
  ) {
    shown = shown.slice(0, Math.floor(shown.length * 0.8));
  }
  return shown;
}

function render(
  shown: ObjectTypeSummary[],
  total: number,
  version: string,
  args: DiscoverArgs,
): string {
  const lines = [
    `# NetBox object types (NetBox ${version})`,
    "",
    shown.length === total
      ? `${total} type(s) match ${describeFilter(args)}.`
      : `${total} type(s) match ${describeFilter(args)}; showing the first ${shown.length}. Narrow with \`query\` or \`app\` to see the rest.`,
    "",
    ...shown.map(line),
    "",
    "Next: call netbox_describe with the object_type you picked and the operation you intend (list, get, create, update or delete).",
  ];
  return lines.join("\n");
}
