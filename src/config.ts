/**
 * Environment configuration for the NetBox MCP server.
 *
 * Required:
 *   NETBOX_URL   - base URL of the NetBox instance (e.g. https://netbox.example.com)
 *   NETBOX_TOKEN - API token
 *
 * Optional:
 *   NETBOX_INSECURE - "1"/"true"/"yes" to skip TLS verification
 */

import { ENV_NETBOX_INSECURE, ENV_NETBOX_TOKEN, ENV_NETBOX_URL } from "./constants.js";

export interface NetBoxConfig {
  /** Fully qualified base URL, no trailing slash. */
  baseUrl: string;
  /** Derived API root, e.g. https://netbox.example.com/api */
  apiUrl: string;
  /** API token. */
  token: string;
  /** Whether to allow self-signed TLS certificates. */
  insecure: boolean;
}

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

/**
 * Read and validate environment configuration. Throws with an actionable
 * message if required variables are missing or malformed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): NetBoxConfig {
  const rawUrl = (env[ENV_NETBOX_URL] ?? "").trim();
  const token = (env[ENV_NETBOX_TOKEN] ?? "").trim();
  const insecure = parseBool(env[ENV_NETBOX_INSECURE]);

  if (!rawUrl) {
    throw new Error(
      `Missing required environment variable ${ENV_NETBOX_URL}. ` +
        `Set it to the base URL of your NetBox instance, e.g. https://netbox.example.com`,
    );
  }
  if (!token) {
    throw new Error(
      `Missing required environment variable ${ENV_NETBOX_TOKEN}. ` +
        `Create a token in NetBox under "Admin > API Tokens".`,
    );
  }

  // Normalize the URL: strip trailing slash and any trailing /api.
  let baseUrl = rawUrl.replace(/\/+$/, "");
  baseUrl = baseUrl.replace(/\/api$/i, "");

  try {
    // Validate URL shape.
    void new URL(baseUrl);
  } catch {
    throw new Error(
      `${ENV_NETBOX_URL} is not a valid URL: "${rawUrl}". ` +
        `Expected something like https://netbox.example.com`,
    );
  }

  return {
    baseUrl,
    apiUrl: `${baseUrl}/api`,
    token,
    insecure,
  };
}
