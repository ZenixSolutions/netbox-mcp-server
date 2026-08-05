/**
 * Layers 1 and 2: `netbox_discover` and `netbox_describe`.
 *
 * Both are pure metadata. What matters is that they are navigable: discover
 * hands back keys describe accepts, describe hands back exactly the field set
 * `netbox_write` will enforce, and neither ever asks the caller to guess.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { CHARACTER_LIMIT } from "../../src/constants.js";
import type {
  DescribeResult,
  FieldSpec,
  ListObjectTypesFilter,
  ObjectTypeSummary,
  Operation,
  SchemaProvider,
} from "../../src/schema/types.js";

const http = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  raw: vi.fn(),
}));

vi.mock("../../src/client.js", () => ({ getClient: () => http }));

const { registerLayeredTools } = await import("../../src/tools/layered/index.js");

const TYPES: ObjectTypeSummary[] = [
  {
    object_type: "dcim.device",
    label: "Device",
    endpoint: "dcim/devices",
    app: "dcim",
    operations: ["list", "get", "create", "update", "delete"],
    summary: "A piece of hardware installed in a rack.",
  },
  {
    object_type: "ipam.prefix",
    label: "Prefix",
    endpoint: "ipam/prefixes",
    app: "ipam",
    operations: ["list", "get", "create", "update", "delete"],
    summary: "An IPv4 or IPv6 network.",
  },
  {
    object_type: "core.job",
    label: "Job",
    endpoint: "core/jobs",
    app: "core",
    operations: ["list", "get"],
    summary: "A background job.",
  },
];

const DEVICE_FIELDS: FieldSpec[] = [
  { name: "id", type: "integer", required: false, readOnly: true },
  { name: "url", type: "string", required: false, readOnly: true },
  {
    name: "name",
    type: "string",
    required: true,
    readOnly: false,
    description: "Hostname, unique within the site.",
  },
  {
    name: "device_type",
    type: "integer",
    required: true,
    readOnly: false,
    refersTo: "dcim.devicetype",
    acceptsId: true,
  },
  {
    name: "status",
    type: "string",
    required: false,
    readOnly: false,
    enum: ["offline", "active", "planned"],
  },
  { name: "comments", type: "string", required: false, readOnly: false, nullable: true },
];

const filterCalls: ListObjectTypesFilter[] = [];

function provider(types: ObjectTypeSummary[] = TYPES): SchemaProvider {
  return {
    version: () => Promise.resolve("4.6.7"),
    listObjectTypes: (filter?: ListObjectTypesFilter) => {
      if (filter) filterCalls.push(filter);
      const app = filter?.app;
      const query = filter?.query?.toLowerCase();
      return Promise.resolve(
        types.filter(
          (t) =>
            (app === undefined || t.app === app) &&
            (query === undefined ||
              `${t.object_type} ${t.label} ${t.summary}`.toLowerCase().includes(query)),
        ),
      );
    },
    resolve: (key: string) =>
      Promise.resolve(types.find((t) => t.object_type === key) ?? undefined),
    describe: (objectType: string, operation: Operation): Promise<DescribeResult> =>
      Promise.resolve({
        object_type: objectType,
        operation,
        endpoint: "dcim/devices",
        fields: operation === "create" || operation === "update" ? DEVICE_FIELDS : [],
        ...(operation === "list"
          ? {
              filters: [
                { name: "site", type: "string", description: "Site slug." },
                { name: "status", type: "string" },
              ],
              filterGrammar:
                "Most filters accept `__n` (negation), `__ic` (case-insensitive contains) and comparison suffixes.",
            }
          : {}),
        dependsOn:
          operation === "create"
            ? ["dcim.site", "dcim.devicetype", "dcim.devicerole"]
            : [],
        notes:
          operation === "create" ? ["A device name must be unique within its site."] : [],
      }),
  };
}

async function connect(schema: SchemaProvider = provider()): Promise<Client> {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerLayeredTools(server, schema);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** Parse a tool result without casts: content blocks, error flag, payload. */
const Outcome = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  isError: z.boolean().optional(),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
});

interface ToolOutcome {
  text: string;
  isError: boolean;
  structured: Record<string, unknown> | undefined;
}

function outcome(raw: unknown): ToolOutcome {
  const parsed = Outcome.parse(raw);
  return {
    text: parsed.content[0]?.text ?? "",
    isError: parsed.isError === true,
    structured: parsed.structuredContent,
  };
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  return outcome(await client.callTool({ name, arguments: args }));
}

let client: Client;

beforeEach(async () => {
  filterCalls.length = 0;
  for (const fn of Object.values(http)) fn.mockReset();
  client = await connect();
});

afterEach(async () => {
  await client.close();
});

describe("netbox_discover", () => {
  it("returns one line per object type and points at the next layer", async () => {
    const result = await call(client, "netbox_discover", {});
    for (const type of TYPES) {
      expect(result.text).toContain(`\`${type.object_type}\``);
      expect(result.text).toContain(type.summary);
    }
    expect(result.text).toContain("netbox_describe");
    expect(result.text).toContain("NetBox 4.6.7");
  });

  it("advertises each type's real operations", async () => {
    const result = await call(client, "netbox_discover", {});
    expect(result.text).toContain("[list,get,create,update,delete]");
    expect(result.text).toContain("[list,get]");
  });

  it("passes query and app through to the provider", async () => {
    await call(client, "netbox_discover", { query: "prefix", app: "ipam" });
    expect(filterCalls[0]).toEqual({ query: "prefix", app: "ipam" });
  });

  it("omits an absent filter rather than sending undefined", async () => {
    await call(client, "netbox_discover", { app: "dcim" });
    expect(filterCalls[0]).toEqual({ app: "dcim" });
  });

  it("filters rather than returning everything", async () => {
    const result = await call(client, "netbox_discover", { app: "ipam" });
    expect(result.text).toContain("ipam.prefix");
    expect(result.text).not.toContain("dcim.device");
  });

  it("says how to widen the search when nothing matched", async () => {
    const result = await call(client, "netbox_discover", {
      query: "nothing-matches-this",
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("No object type matches");
    expect(result.text).toContain("netbox_discover");
  });

  it("stays inside the response budget for a large registry", async () => {
    const many: ObjectTypeSummary[] = Array.from({ length: 900 }, (_, i) => ({
      object_type: `dcim.thing${i}`,
      label: `Thing ${i}`,
      endpoint: `dcim/things-${i}`,
      app: "dcim",
      operations: ["list", "get", "create", "update", "delete"],
      summary: "A synthetic object type with a summary of a realistic length.",
    }));
    const big = await connect(provider(many));
    const result = await call(big, "netbox_discover", {});
    expect(result.text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(result.text).toContain("Narrow with");
    await big.close();
  });
});

describe("netbox_describe", () => {
  it("separates required, optional and read-only fields", async () => {
    const result = await call(client, "netbox_describe", {
      object_type: "dcim.device",
      operation: "create",
    });
    const required = section(result.text, "## Required fields");
    const optional = section(result.text, "## Optional fields");
    const readOnly = section(result.text, "## Read-only fields");

    expect(required).toContain("`name`");
    expect(required).toContain("`device_type`");
    expect(required).not.toContain("`status`");

    expect(optional).toContain("`status`");
    expect(optional).toContain("`comments`");

    // A read-only field is never something the caller supplies.
    expect(required).not.toContain("`id`");
    expect(optional).not.toContain("`id`");
    expect(readOnly).toContain("`id`");
    expect(readOnly).toContain("`url`");
  });

  it("spells out enum values and foreign-key targets", async () => {
    const result = await call(client, "netbox_describe", {
      object_type: "dcim.device",
      operation: "create",
    });
    expect(result.text).toContain("one of: offline | active | planned");
    expect(result.text).toContain("reference to dcim.devicetype (pass its numeric id)");
    expect(result.text).toContain("Hostname, unique within the site.");
  });

  it("names the object types that must exist first", async () => {
    const result = await call(client, "netbox_describe", {
      object_type: "dcim.device",
      operation: "create",
    });
    expect(result.text).toContain("Must exist first");
    for (const dep of ["dcim.site", "dcim.devicetype", "dcim.devicerole"]) {
      expect(result.text).toContain(dep);
    }
    expect(result.structured?.depends_on).toEqual([
      "dcim.site",
      "dcim.devicetype",
      "dcim.devicerole",
    ]);
  });

  it("says that update is partial", async () => {
    const result = await call(client, "netbox_describe", {
      object_type: "dcim.device",
      operation: "update",
    });
    expect(result.text).toContain("partial write");
  });

  it("summarises filters and the lookup grammar for list", async () => {
    const result = await call(client, "netbox_describe", {
      object_type: "dcim.device",
      operation: "list",
    });
    expect(result.text).toContain("## Accepted filters");
    expect(result.text).toContain("`site`");
    expect(result.text).toContain("Site slug.");
    expect(result.text).toContain("`__ic`");
  });

  it("documents the delete confirmation on the delete description", async () => {
    const result = await call(client, "netbox_describe", {
      object_type: "dcim.device",
      operation: "delete",
    });
    expect(result.text).toContain("must equal the object's current `display` value");
  });

  it("suggests near misses for an unknown object type", async () => {
    const result = await call(client, "netbox_describe", {
      object_type: "device",
      operation: "create",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Did you mean: dcim.device");
  });

  it("names the supported operations for an unsupported one", async () => {
    const result = await call(client, "netbox_describe", {
      object_type: "core.job",
      operation: "delete",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('does not support "delete"');
    expect(result.text).toContain("Supported: list, get");
  });
});

/** Text between a heading and the next one. */
function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const rest = text.slice(start + heading.length);
  const end = rest.indexOf("\n## ");
  return end < 0 ? rest : rest.slice(0, end);
}
