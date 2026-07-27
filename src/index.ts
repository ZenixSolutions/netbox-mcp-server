#!/usr/bin/env node
/**
 * netbox-mcp-server
 *
 * MCP server exposing the NetBox REST API (DCIM + IPAM) to LLM agents.
 * Reads NETBOX_URL and NETBOX_TOKEN from environment. stdio transport only.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { ALL_TOOL_GROUPS, enabledGroups } from "./gating.js";
import { registerDcim } from "./tools/dcim.js";
import { registerInventory } from "./tools/inventory.js";
import { registerIpam } from "./tools/ipam.js";
import { registerPower } from "./tools/power.js";
import { registerDcimOrg } from "./tools/dcim_org.js";
import { registerTenancy } from "./tools/tenancy.js";
import { registerIpamOrg } from "./tools/ipam_org.js";
import { registerDcimComponents } from "./tools/dcim_components.js";
import { registerVirtualization } from "./tools/virtualization.js";
import { registerCircuits } from "./tools/circuits.js";
import { registerIpamServices } from "./tools/ipam_services.js";
import { registerDeletes } from "./tools/deletes.js";
import { registerSearch } from "./tools/search.js";

const SERVER_NAME = "netbox-mcp-server";
const SERVER_VERSION = "1.0.0";

function buildServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const groups = enabledGroups();
  const on = (name: string, register: (s: McpServer) => void): void => {
    if (groups.has(name)) register(server);
  };

  on("search", registerSearch);
  on("dcim", registerDcim);
  on("ipam", registerIpam);
  on("inventory", registerInventory);
  on("power", registerPower);
  on("dcim_org", registerDcimOrg);
  on("tenancy", registerTenancy);
  on("ipam_org", registerIpamOrg);
  on("dcim_components", registerDcimComponents);
  on("virtualization", registerVirtualization);
  on("circuits", registerCircuits);
  on("ipam_services", registerIpamServices);
  on("deletes", registerDeletes);

  return server;
}

async function runStdio(): Promise<void> {
  // Fail fast with a clear message if env is missing.
  try {
    loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

async function main(): Promise<void> {
  // Support `--help` for quick command-line discovery.
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      [
        `${SERVER_NAME} v${SERVER_VERSION}`,
        "",
        "MCP server exposing the NetBox REST API (DCIM + IPAM + Power + Inventory plugin).",
        "",
        "Required environment variables:",
        "  NETBOX_URL    Base URL of the NetBox instance, e.g. https://netbox.example.com",
        "  NETBOX_TOKEN  NetBox API token (Admin > API Tokens)",
        "",
        "Optional environment variables:",
        "  NETBOX_INSECURE     Set to 1/true/yes to disable TLS certificate verification",
        "  NETBOX_READONLY     Set to 1/true/yes to register only list/get/search tools",
        "                      (create, update and delete tools are omitted entirely)",
        "  NETBOX_TOOL_GROUPS  Comma-separated allowlist of tool groups to register.",
        `                      Unset = all. Valid: ${ALL_TOOL_GROUPS.join(", ")}`,
        "                      Anything not named is omitted, including 'deletes'.",
        "",
        "Transport: stdio only. This binary is intended to be launched as a",
        "subprocess by an MCP-aware client (Claude Desktop, Claude Code, Codex, etc.).",
      ].join("\n"),
    );
    return;
  }
  await runStdio();
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
