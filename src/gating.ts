/**
 * Optional tool-surface gating.
 *
 * Both controls are OFF by default — with no environment variables set the
 * server registers exactly the tools it always has. They exist so an
 * administrator can hand out a narrower server to most users:
 *
 *   NETBOX_READONLY=1                  omit every create/update/delete tool
 *   NETBOX_TOOL_GROUPS=dcim,ipam       register only the named groups
 */

import { ENV_NETBOX_READONLY, ENV_NETBOX_TOOL_GROUPS } from "./constants.js";

/** Every tool group name understood by NETBOX_TOOL_GROUPS. */
export const ALL_TOOL_GROUPS = [
  "search",
  "dcim",
  "dcim_org",
  "dcim_components",
  "ipam",
  "ipam_org",
  "ipam_services",
  "inventory",
  "power",
  "tenancy",
  "virtualization",
  "circuits",
  "deletes",
] as const;

export type ToolGroup = (typeof ALL_TOOL_GROUPS)[number];

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

/** True when NETBOX_READONLY is set to a truthy value. */
export function isReadOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBool(env[ENV_NETBOX_READONLY]);
}

/**
 * The set of groups to register. Unset / empty means "all groups".
 * Unknown names are ignored with a warning on stderr rather than crashing, so
 * a typo in a client config degrades instead of breaking the server.
 */
export function enabledGroups(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = (env[ENV_NETBOX_TOOL_GROUPS] ?? "").trim();
  if (!raw) return new Set(ALL_TOOL_GROUPS);

  const requested = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const known = new Set<string>(ALL_TOOL_GROUPS);
  const unknown = requested.filter((g) => !known.has(g));
  if (unknown.length > 0) {
    console.error(
      `[netbox-mcp-server] ignoring unknown ${ENV_NETBOX_TOOL_GROUPS} value(s): ` +
        `${unknown.join(", ")}. Valid groups: ${ALL_TOOL_GROUPS.join(", ")}`,
    );
  }

  const selected = requested.filter((g) => known.has(g));
  if (selected.length === 0) {
    console.error(
      `[netbox-mcp-server] ${ENV_NETBOX_TOOL_GROUPS} matched no valid groups; registering all groups.`,
    );
    return new Set(ALL_TOOL_GROUPS);
  }
  return new Set(selected);
}
