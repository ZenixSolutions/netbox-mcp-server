/**
 * `netbox_read`: pagination, truncation, and the errors that teach.
 *
 * The read half exists separately from the write half so `readOnlyHint: true`
 * is true of every call it can make. Nothing in this file may cause a write.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { CHARACTER_LIMIT } from "../../src/constants.js";
import type {
  DescribeResult,
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
    object_type: "core.objectchange",
    label: "Change Record",
    endpoint: "core/object-changes",
    app: "core",
    operations: ["list"],
    summary: "An audit-log entry. Cannot be fetched individually.",
  },
];

function provider(): SchemaProvider {
  return {
    version: () => Promise.resolve("4.6.7"),
    listObjectTypes: () => Promise.resolve(TYPES),
    resolve: (key: string) =>
      Promise.resolve(TYPES.find((t) => t.object_type === key) ?? undefined),
    describe: (objectType: string, operation: Operation): Promise<DescribeResult> =>
      Promise.resolve({
        object_type: objectType,
        operation,
        endpoint: "dcim/devices",
        fields: [],
        filters: [{ name: "site", type: "string", description: "Site slug." }],
        filterGrammar: "Most filters accept `__n`, `__ic`, `__gte` and similar suffixes.",
        dependsOn: [],
        notes: [],
      }),
  };
}

async function connect(): Promise<Client> {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerLayeredTools(server, provider());
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

async function read(client: Client, args: Record<string, unknown>): Promise<ToolOutcome> {
  return outcome(await client.callTool({ name: "netbox_read", arguments: args }));
}

function page(count: number, size: number, prefix = "sw"): unknown {
  return {
    count,
    next: null,
    previous: null,
    results: Array.from({ length: size }, (_, i) => ({
      id: i + 1,
      display: `${prefix}-${i + 1}`,
      name: `${prefix}-${i + 1}`,
    })),
  };
}

let client: Client;

beforeEach(async () => {
  for (const fn of Object.values(http)) fn.mockReset();
  client = await connect();
});

afterEach(async () => {
  await client.close();
});

describe("list", () => {
  it("passes limit, offset and filters to the resolved endpoint", async () => {
    http.list.mockResolvedValue(page(3, 3));
    await read(client, {
      object_type: "ipam.prefix",
      operation: "list",
      filters: { site: "dc1", status: ["active", "reserved"] },
      limit: 10,
      offset: 20,
    });
    expect(http.list).toHaveBeenCalledWith("ipam/prefixes", {
      site: "dc1",
      status: ["active", "reserved"],
      limit: 10,
      offset: 20,
    });
  });

  it("reports pagination state so the caller can continue", async () => {
    http.list.mockResolvedValue(page(130, 50));
    const result = await read(client, {
      object_type: "dcim.device",
      operation: "list",
      limit: 50,
      offset: 0,
      response_format: "json",
    });
    expect(result.structured).toMatchObject({
      total: 130,
      count: 50,
      offset: 0,
      limit: 50,
      has_more: true,
      next_offset: 50,
    });
  });

  it("marks the final page as complete", async () => {
    http.list.mockResolvedValue(page(130, 30));
    const result = await read(client, {
      object_type: "dcim.device",
      operation: "list",
      limit: 50,
      offset: 100,
      response_format: "json",
    });
    expect(result.structured).toMatchObject({ has_more: false });
    expect(result.structured?.next_offset).toBeUndefined();
  });

  it("truncates an oversized page and says where to resume", async () => {
    // 400 rows of padded text comfortably exceeds the 25,000-char budget.
    http.list.mockResolvedValue({
      count: 400,
      next: null,
      previous: null,
      results: Array.from({ length: 400 }, (_, i) => ({
        id: i + 1,
        display: `device-${i + 1}`,
        name: `device-${i + 1}`,
        comments: "x".repeat(200),
      })),
    });
    const result = await read(client, {
      object_type: "dcim.device",
      operation: "list",
      limit: 400,
      offset: 0,
    });
    expect(result.text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(result.text).toContain("Response truncated");
    expect(result.text).toContain("offset=");
    expect(result.structured?.has_more).toBe(true);
    expect(result.structured?.count).toBeLessThan(400);
  });

  it("renders an empty result without pretending it failed", async () => {
    http.list.mockResolvedValue(page(0, 0));
    const result = await read(client, { object_type: "dcim.device", operation: "list" });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("(no results)");
  });

  it("points at netbox_describe when NetBox rejects a filter", async () => {
    http.list.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 400"), {
        isAxiosError: true,
        response: { status: 400, data: { detail: "Unknown filter field" } },
        toJSON: () => ({}),
      }),
    );
    const result = await read(client, {
      object_type: "dcim.device",
      operation: "list",
      filters: { nonsense: "1" },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Error: NetBox rejected the request (400 Bad Request)");
    expect(result.text).toContain("netbox_describe");
  });
});

describe("get", () => {
  it("fetches by id and renders the object", async () => {
    http.get.mockResolvedValue({ id: 7, display: "sw-core-01", name: "sw-core-01" });
    const result = await read(client, {
      object_type: "dcim.device",
      operation: "get",
      id: 7,
    });
    expect(http.get).toHaveBeenCalledWith("dcim/devices", 7);
    expect(result.text).toContain("sw-core-01");
  });

  it("asks for the id rather than guessing one", async () => {
    const result = await read(client, { object_type: "dcim.device", operation: "get" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("'get' needs an 'id'");
    expect(http.get).not.toHaveBeenCalled();
  });

  it("returns raw JSON when asked", async () => {
    http.get.mockResolvedValue({ id: 7, display: "sw-core-01", custom_fields: { a: 1 } });
    const result = await read(client, {
      object_type: "dcim.device",
      operation: "get",
      id: 7,
      response_format: "json",
    });
    expect(result.text).toContain('"custom_fields"');
  });
});

describe("errors teach", () => {
  it("suggests near misses for an unknown object type", async () => {
    const result = await read(client, { object_type: "dcim.devcie", operation: "list" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Unknown object type "dcim.devcie"');
    expect(result.text).toContain("Did you mean: dcim.device");
    expect(http.list).not.toHaveBeenCalled();
  });

  it("suggests near misses for a plausible-but-wrong name", async () => {
    const result = await read(client, {
      object_type: "ipam.prefixes",
      operation: "list",
    });
    expect(result.text).toContain("Did you mean: ipam.prefix");
  });

  it("falls back to pointing at netbox_discover when nothing is close", async () => {
    const result = await read(client, { object_type: "zzzzzzzz", operation: "list" });
    expect(result.text).toContain("Call netbox_discover");
  });

  it("names the supported operations when one is not available", async () => {
    const result = await read(client, {
      object_type: "core.objectchange",
      operation: "get",
      id: 1,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('does not support "get"');
    expect(result.text).toContain("Supported: list");
    expect(http.get).not.toHaveBeenCalled();
  });

  it("rejects a filter name that is not a query parameter", async () => {
    const result = await read(client, {
      object_type: "dcim.device",
      operation: "list",
      filters: { "site;drop": "x" },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("not a NetBox filter name");
    expect(http.list).not.toHaveBeenCalled();
  });
});
