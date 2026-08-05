/**
 * One MCP session against the real server, with every tool call recorded.
 *
 * The server is the actual one an MCP client would get — `buildServer()` with
 * the real schema provider — connected over an in-memory transport rather than
 * stdio. Nothing here reimplements a tool; if a tool changes, this changes with
 * it, which is the only way an eval is worth running.
 *
 * The session is also the safety boundary. `callTool` will not send a
 * `netbox_write` call unless the step carrying it has been proven harmless
 * (see `assertReadOnlySafe`), and writes are only ever executed for real
 * behind an explicit opt-in.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { loadConfig } from "../../src/config.js";
import { createSchemaProviderForConfig } from "../../src/schema/index.js";
import type { SchemaProvider } from "../../src/schema/types.js";
import { buildServer } from "../../src/server.js";
import { asArray, asRecord, asString } from "../../tests/contract/http.js";
import type { ToolCall, ToolName } from "../types.js";

export interface Session {
  /** Call a tool for real and record the result. */
  call(tool: ToolName, args: Record<string, unknown>, index: number): Promise<ToolCall>;
  /** Record a call that was deliberately NOT sent. */
  simulate(
    tool: ToolName,
    args: Record<string, unknown>,
    index: number,
    verdict: string,
    isError: boolean,
  ): ToolCall;
  /** The provider the server itself uses, for local payload validation. */
  schema: SchemaProvider;
  /** Tool names the server advertises, from a real `tools/list`. */
  advertised: string[];
  /** The advertised input schema of each tool, flattened to what can be checked. */
  toolSchemas: Map<string, ToolArgumentSchema>;
  close(): Promise<void>;
}

/** The checkable part of a tool's advertised JSON Schema. */
export interface ToolArgumentSchema {
  properties: Set<string>;
  required: Set<string>;
}

function argumentSchemaOf(inputSchema: unknown): ToolArgumentSchema {
  const record = asRecord(inputSchema);
  return {
    properties: new Set(Object.keys(asRecord(record?.["properties"]) ?? {})),
    required: new Set(
      (asArray(record?.["required"]) ?? []).flatMap((name) => {
        const text = asString(name);
        return text === undefined ? [] : [text];
      }),
    ),
  };
}

/**
 * Text content of a result, concatenated.
 *
 * `callTool` is typed as a union with the legacy `{ toolResult }` shape, so
 * every field arrives as `unknown` and is narrowed here rather than asserted.
 * Non-text blocks are named rather than dropped: a tool that starts returning
 * images should show up in the transcript, not vanish from it.
 */
function textOf(result: unknown): string {
  const blocks = asArray(asRecord(result)?.["content"]) ?? [];
  return blocks
    .map((block) => {
      const record = asRecord(block);
      const type = asString(record?.["type"]) ?? "unknown";
      return type === "text" ? (asString(record?.["text"]) ?? "") : `<${type}>`;
    })
    .join("\n");
}

function isErrorResult(result: unknown): boolean {
  return asRecord(result)?.["isError"] === true;
}

export async function openSession(): Promise<Session> {
  const schema = createSchemaProviderForConfig(loadConfig(process.env));
  const server = buildServer(process.env, { schema });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "netbox-mcp-eval", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listed = await client.listTools();
  const advertised = listed.tools.map((tool) => tool.name);
  const toolSchemas = new Map(
    listed.tools.map((tool) => [tool.name, argumentSchemaOf(tool.inputSchema)]),
  );

  return {
    schema,
    advertised,
    toolSchemas,
    async call(tool, args, index) {
      const startedAt = Date.now();
      const result = await client.callTool(
        { name: tool, arguments: args },
        undefined,
        // A single tool call that needs more than this is itself a finding,
        // but the schema fetch on the first call is legitimately slow.
        { timeout: 300_000 },
      );
      return {
        index,
        tool,
        args,
        simulated: false,
        isError: isErrorResult(result),
        text: textOf(result),
        structured: asRecord(asRecord(result)?.["structuredContent"]),
        elapsedMs: Date.now() - startedAt,
      };
    },
    simulate(tool, args, index, verdict, isError) {
      return {
        index,
        tool,
        args,
        simulated: true,
        isError,
        text: verdict,
        structured: undefined,
        elapsedMs: 0,
      };
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
