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

/**
 * Registration-time environment.
 *
 * The registrars in `registrars.ts` decide whether to register a write tool by
 * calling `isReadOnly()` with no argument, from deep inside a call tree that
 * has no environment to thread. Reading `process.env` there directly made the
 * gate untestable — and a control that cannot be tested is a control that is
 * assumed, which Article VIII does not allow.
 *
 * `withEnv` scopes an environment for the duration of a synchronous
 * registration pass. It is not a general-purpose ambient context: nothing
 * asynchronous may run inside the callback.
 */
let envOverride: NodeJS.ProcessEnv | undefined;

export function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
  const previous = envOverride;
  envOverride = env;
  try {
    return fn();
  } finally {
    envOverride = previous;
  }
}

function currentEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return env ?? envOverride ?? process.env;
}

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
export function isReadOnly(env?: NodeJS.ProcessEnv): boolean {
  return parseBool(currentEnv(env)[ENV_NETBOX_READONLY]);
}

/**
 * The set of groups to register. Unset / empty means "all groups".
 * Unknown names are ignored with a warning on stderr rather than crashing, so
 * a typo in a client config degrades instead of breaking the server.
 */
export function enabledGroups(env?: NodeJS.ProcessEnv): Set<string> {
  const raw = (currentEnv(env)[ENV_NETBOX_TOOL_GROUPS] ?? "").trim();
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
