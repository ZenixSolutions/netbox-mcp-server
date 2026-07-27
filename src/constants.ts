/**
 * Shared constants.
 */

/**
 * Maximum character size of a single tool response. Responses larger than this
 * are truncated with a clear message guiding the caller to filter or paginate.
 */
export const CHARACTER_LIMIT = 25000;

/** Default page size for list operations. */
export const DEFAULT_LIMIT = 50;

/** Maximum page size a caller may request. */
export const MAX_LIMIT = 1000;

/** Default HTTP timeout for NetBox API calls (ms). */
export const DEFAULT_TIMEOUT_MS = 30000;

/** Required environment variable: full base URL of the NetBox instance, e.g. `https://netbox.example.com`. */
export const ENV_NETBOX_URL = "NETBOX_URL";

/** Required environment variable: NetBox API token. */
export const ENV_NETBOX_TOKEN = "NETBOX_TOKEN";

/**
 * Optional environment variable: "1" / "true" / "yes" to allow self-signed TLS
 * certificates (common for on-prem NetBox). Defaults to verifying TLS.
 */
export const ENV_NETBOX_INSECURE = "NETBOX_INSECURE";

/**
 * Optional environment variable: "1" / "true" / "yes" to register only the
 * read-only tools (`netbox_list_*`, `netbox_get_*`, `netbox_global_search`).
 * All create/update/delete tools are omitted entirely, so the model cannot
 * call them. Defaults to off (full read/write surface).
 */
export const ENV_NETBOX_READONLY = "NETBOX_READONLY";

/**
 * Optional environment variable: comma-separated list of tool groups to
 * register, e.g. "dcim,ipam,search". Unset (the default) registers every
 * group. Use this to keep a client's tool count manageable.
 * Valid groups: search, dcim, dcim_org, dcim_components, ipam, ipam_org,
 * ipam_services, inventory, power, tenancy, virtualization, circuits,
 * deletes.
 */
export const ENV_NETBOX_TOOL_GROUPS = "NETBOX_TOOL_GROUPS";
