/**
 * Cross-object fuzzy search.
 *
 * NetBox doesn't have a single "search everything" endpoint, but the `q` query
 * parameter is supported on every list endpoint. This tool fans a query out to
 * the most commonly searched resources in parallel and returns a compact
 * aggregate.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getClient, PaginatedResponse } from "../client.js";
import { handleApiError } from "../errors.js";
import { displayRef, ResponseFormat, toDisplayString } from "../formatting.js";
import { ResponseFormatField } from "../schemas/common.js";

const SEARCH_TARGETS: { endpoint: string; label: string }[] = [
  { endpoint: "dcim/sites", label: "sites" },
  { endpoint: "dcim/racks", label: "racks" },
  { endpoint: "dcim/devices", label: "devices" },
  { endpoint: "dcim/interfaces", label: "interfaces" },
  { endpoint: "ipam/prefixes", label: "prefixes" },
  { endpoint: "ipam/ip-addresses", label: "ip_addresses" },
  { endpoint: "ipam/vlans", label: "vlans" },
  { endpoint: "ipam/vrfs", label: "vrfs" },
  { endpoint: "plugins/inventory/assets", label: "assets" },
];

const Input = z
  .object({
    query: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "Text to search for (passed as NetBox's `q` parameter on every resource).",
      ),
    limit_per_resource: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(5)
      .describe("Max hits to return per resource (1-50, default 5)."),
    resources: z
      .array(
        z.enum([
          "sites",
          "racks",
          "devices",
          "interfaces",
          "prefixes",
          "ip_addresses",
          "vlans",
          "vrfs",
          "assets",
        ]),
      )
      .optional()
      .describe("If provided, restrict the search to these resource labels."),
    response_format: ResponseFormatField,
  })
  .strict();

type InputType = z.infer<typeof Input>;

interface SectionResult {
  label: string;
  total: number;
  items: Record<string, unknown>[];
  error?: string;
}

export function registerSearch(server: McpServer): void {
  server.registerTool(
    "netbox_global_search",
    {
      title: "Global NetBox Search",
      description: `Fuzzy search across sites, racks, devices, interfaces, prefixes, IPs, VLANs, and VRFs in one call.

Use when the user gives a name, hostname, partial identifier, VLAN name, description keyword, etc. and you don't know which object type they mean. Dispatches the query to every supported resource in parallel and aggregates the top hits.

Args:
  - query (string, required)         The text to search for.
  - limit_per_resource (number)      Max hits per resource (default 5).
  - resources (string[])             Restrict to a subset of resource labels.
  - response_format ('markdown' | 'json')

Returns:
  Aggregated results keyed by resource with per-resource totals. Follow up with
  netbox_get_<resource> to retrieve a specific hit.`,
      inputSchema: Input.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: InputType) => {
      try {
        const client = getClient();
        const selected: readonly string[] | undefined = params.resources;
        const targets = selected
          ? SEARCH_TARGETS.filter((t) => selected.includes(t.label))
          : SEARCH_TARGETS;

        const settled = await Promise.allSettled(
          targets.map(async (t) => {
            const data: PaginatedResponse<Record<string, unknown>> = await client.list(
              t.endpoint,
              {
                q: params.query,
                limit: params.limit_per_resource,
              },
            );
            const section: SectionResult = {
              label: t.label,
              total: data.count,
              items: data.results,
            };
            return section;
          }),
        );

        const sections: SectionResult[] = settled.map((r, i) => {
          if (r.status === "fulfilled") return r.value;
          return {
            label: targets[i]?.label ?? "unknown",
            total: 0,
            items: [],
            error: handleApiError(r.reason),
          };
        });

        if (params.response_format === ResponseFormat.JSON) {
          const payload = {
            query: params.query,
            grand_total: sections.reduce((s, x) => s + x.total, 0),
            results: Object.fromEntries(sections.map((s) => [s.label, s])),
          };
          return {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
            structuredContent: payload,
          };
        }

        const lines: string[] = [`# NetBox search: "${params.query}"`, ""];
        const grandTotal = sections.reduce((s, x) => s + x.total, 0);
        lines.push(
          `Found ${grandTotal} total hits across ${sections.length} resource(s).`,
          "",
        );
        for (const section of sections) {
          if (section.error) {
            lines.push(`## ${section.label} — ERROR`);
            lines.push(section.error);
            lines.push("");
            continue;
          }
          lines.push(`## ${section.label} (${section.total} total)`);
          if (section.items.length === 0) {
            lines.push("_(no hits)_");
          } else {
            for (const item of section.items) {
              const display = toDisplayString(
                item.display ??
                  item.name ??
                  displayRef(item) ??
                  item.address ??
                  item.prefix ??
                  item.vid ??
                  `#${toDisplayString(item.id)}`,
              );
              const extras: string[] = [];
              const parent =
                displayRef(item.device) ?? displayRef(item.site) ?? displayRef(item.vrf);
              if (parent) extras.push(`on ${parent}`);
              if (item.status && typeof item.status === "object") {
                const statusLabel = displayRef(item.status);
                if (statusLabel) extras.push(`status=${statusLabel}`);
              }
              lines.push(
                `- **${display}** (id=${toDisplayString(item.id)})${
                  extras.length ? " — " + extras.join(", ") : ""
                }`,
              );
            }
          }
          lines.push("");
        }
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: {
            query: params.query,
            grand_total: grandTotal,
            results: Object.fromEntries(sections.map((s) => [s.label, s])),
          },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleApiError(error) }],
        };
      }
    },
  );
}
