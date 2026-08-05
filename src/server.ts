/**
 * Server construction and introspection.
 *
 * Kept separate from `index.ts` so the server can be built and inspected
 * in-process, without starting a transport as an import side effect. The
 * entry point is an executable; importing an executable to test it is not a
 * thing we want anyone to have to do.
 */

import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { enabledGroups, withEnv } from "./gating.js";
import { registerCircuits } from "./tools/circuits.js";
import { registerDcim } from "./tools/dcim.js";
import { registerDcimComponents } from "./tools/dcim_components.js";
import { registerDcimOrg } from "./tools/dcim_org.js";
import { registerDeletes } from "./tools/deletes.js";
import { registerInventory } from "./tools/inventory.js";
import { registerIpam } from "./tools/ipam.js";
import { registerIpamOrg } from "./tools/ipam_org.js";
import { registerIpamServices } from "./tools/ipam_services.js";
import { registerPower } from "./tools/power.js";
import { registerSearch } from "./tools/search.js";
import { registerTenancy } from "./tools/tenancy.js";
import { registerVirtualization } from "./tools/virtualization.js";

export const SERVER_NAME = "netbox-mcp-server";

/**
 * Read the version from package.json rather than restating it here. A
 * hardcoded copy drifts from what npm publishes, and the drift is silent.
 */
export const SERVER_VERSION: string = (() => {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json") as { version?: unknown };
  return typeof pkg.version === "string" ? pkg.version : "0.0.0-unknown";
})();

const REGISTRARS: [group: string, register: (s: McpServer) => void][] = [
  ["search", registerSearch],
  ["dcim", registerDcim],
  ["ipam", registerIpam],
  ["inventory", registerInventory],
  ["power", registerPower],
  ["dcim_org", registerDcimOrg],
  ["tenancy", registerTenancy],
  ["ipam_org", registerIpamOrg],
  ["dcim_components", registerDcimComponents],
  ["virtualization", registerVirtualization],
  ["circuits", registerCircuits],
  ["ipam_services", registerIpamServices],
  ["deletes", registerDeletes],
];

/**
 * Build a fully registered server. Does not read NetBox configuration — the
 * HTTP client is created lazily on the first tool call — so this is safe to
 * call with no environment set.
 */
export function buildServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const groups = enabledGroups(env);
  // Registration is synchronous, and the registrars consult `isReadOnly()`
  // with no argument from several levels down. `withEnv` is what makes the
  // read-only gate observable from a test.
  withEnv(env, () => {
    for (const [group, register] of REGISTRARS) {
      if (groups.has(group)) register(server);
    }
  });
  return server;
}

export interface ToolSummary {
  name: string;
  description?: string | undefined;
}

/**
 * Enumerate the registered tools over a real MCP handshake on an in-memory
 * transport. Deliberately not a read of the SDK's private registry: what
 * matters is what a client actually receives from `tools/list`.
 */
export async function listTools(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ToolSummary[]> {
  const server = buildServer(env);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "introspect", version: SERVER_VERSION });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.listTools();
    return result.tools.map((t) => ({ name: t.name, description: t.description }));
  } finally {
    await client.close();
    await server.close();
  }
}
