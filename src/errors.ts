/**
 * Error formatting for NetBox API failures.
 *
 * Returns compact, actionable strings that the LLM can relay to the user or
 * use to pick a different approach.
 */

import axios, { AxiosError } from "axios";

/**
 * Convert an unknown error into a user-facing message.
 *
 * Never includes secrets: the formatters below read only the response status
 * and body, never `error.config` (which holds the Authorization header). Keep
 * it that way — any new branch that touches `error.config` must redact it.
 */
export function handleApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return formatAxiosError(error);
  }
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}

function formatAxiosError(error: AxiosError): string {
  // Network / no response.
  if (!error.response) {
    if (error.code === "ECONNABORTED") {
      return "Error: Request to NetBox timed out. The server may be slow or unreachable.";
    }
    if (error.code === "ENOTFOUND") {
      return "Error: NetBox host not found. Check that NETBOX_URL is correct and reachable.";
    }
    if (error.code === "ECONNREFUSED") {
      return "Error: Connection to NetBox refused. Check NETBOX_URL and that the server is running.";
    }
    if (error.code === "CERT_HAS_EXPIRED" || error.code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
      return (
        "Error: TLS certificate verification failed. " +
        "If this is an internal NetBox with a self-signed cert, set NETBOX_INSECURE=1."
      );
    }
    return `Error: Network error contacting NetBox: ${error.message}`;
  }

  const status = error.response.status;
  const bodyMessage = extractNetBoxMessage(error.response.data);

  switch (status) {
    case 400:
      return (
        `Error: NetBox rejected the request (400 Bad Request). ` +
        `${bodyMessage ?? "Check that all required fields are provided and IDs/slugs exist."}`
      );
    case 401:
      return "Error: NetBox authentication failed (401). Check that NETBOX_TOKEN is valid and not expired.";
    case 403:
      return (
        "Error: Permission denied by NetBox (403). " +
        "The API token lacks permission for this object or action."
      );
    case 404:
      return (
        `Error: NetBox object not found (404). ` +
        `Verify the ID/slug is correct. ${bodyMessage ?? ""}`
      ).trim();
    case 409:
      return (
        `Error: Conflict (409). ${bodyMessage ?? "An object with that name/slug likely already exists."}`
      );
    case 429:
      return "Error: NetBox rate limit exceeded (429). Wait a moment and retry.";
    default:
      if (status >= 500) {
        return `Error: NetBox server error (${status}). ${bodyMessage ?? "The NetBox instance may be unhealthy."}`;
      }
      return `Error: NetBox request failed with status ${status}. ${bodyMessage ?? ""}`.trim();
  }
}

/**
 * NetBox returns errors in a few shapes. This extracts the most useful message
 * without assuming a specific structure:
 *   { "detail": "Not found." }
 *   { "field_name": ["This field is required."] }
 *   { "non_field_errors": ["..."] }
 *   plain string
 */
function extractNetBoxMessage(data: unknown): string | undefined {
  if (!data) return undefined;
  if (typeof data === "string") return data;
  if (typeof data !== "object") return undefined;

  const obj = data as Record<string, unknown>;
  if (typeof obj.detail === "string") return obj.detail;

  const parts: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val)) {
      parts.push(`${key}: ${val.join("; ")}`);
    } else if (typeof val === "string") {
      parts.push(`${key}: ${val}`);
    }
  }
  return parts.length > 0 ? parts.join(" | ") : undefined;
}
