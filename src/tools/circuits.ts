/** Circuits tools (Wave 4): providers, accounts, networks, types, circuits, terminations, groups, virtual circuits. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  registerCreate,
  registerGet,
  registerList,
  registerUpdate,
} from "../registrars.js";
import { CustomFieldsSchema, TagSlugsSchema } from "../schemas/common.js";

const SLUG = /^[-a-zA-Z0-9_]+$/;
const CIRCUIT_STATUS = [
  "planned",
  "provisioning",
  "active",
  "offline",
  "deprovisioning",
  "decommissioned",
] as const;
const TERM_SCOPES = [
  "dcim.site",
  "circuits.providernetwork",
  "dcim.region",
  "dcim.sitegroup",
  "dcim.location",
] as const;
const PRIORITY = ["primary", "secondary", "tertiary", "inactive"] as const;

const providerCreate = {
  name: z.string().min(1).max(100).describe("Provider name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  asns: z.array(z.number().int()).optional().describe("ASN object ids."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const providerUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  asns: z.array(z.number().int()).optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const provAcctCreate = {
  provider: z.number().int().describe("Provider id (required)."),
  account: z.string().min(1).max(100).describe("Account identifier (required)."),
  name: z.string().max(100).optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const provAcctUpdate = {
  provider: z.number().int().optional(),
  account: z.string().min(1).max(100).optional(),
  name: z.string().max(100).optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const provNetCreate = {
  provider: z.number().int().describe("Provider id (required)."),
  name: z.string().min(1).max(100).describe("Network name (required)."),
  service_id: z.string().max(100).optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const provNetUpdate = {
  provider: z.number().int().optional(),
  name: z.string().min(1).max(100).optional(),
  service_id: z.string().max(100).optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const circuitTypeCreate = {
  name: z.string().min(1).max(100).describe("Name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  color: z.string().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const circuitTypeUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  color: z.string().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const circuitCreate = {
  cid: z.string().min(1).max(100).describe("Circuit ID (required)."),
  provider: z.number().int().describe("Provider id (required)."),
  type: z.number().int().describe("Circuit type id (required)."),
  status: z.enum(CIRCUIT_STATUS).default("active"),
  provider_account: z.number().int().optional(),
  tenant: z.number().int().optional(),
  install_date: z.string().optional().describe("YYYY-MM-DD."),
  termination_date: z.string().optional().describe("YYYY-MM-DD."),
  commit_rate: z.number().int().optional().describe("Committed rate (kbps)."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const circuitUpdate = {
  cid: z.string().min(1).max(100).optional(),
  provider: z.number().int().optional(),
  type: z.number().int().optional(),
  status: z.enum(CIRCUIT_STATUS).optional(),
  provider_account: z.number().int().nullable().optional(),
  tenant: z.number().int().nullable().optional(),
  install_date: z.string().nullable().optional(),
  termination_date: z.string().nullable().optional(),
  commit_rate: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const circuitTermCreate = {
  circuit: z.number().int().describe("Circuit id (required)."),
  term_side: z.enum(["A", "Z"]).describe("Termination side A or Z (required)."),
  termination_type: z
    .enum(TERM_SCOPES)
    .optional()
    .describe(
      "Scope object type (NetBox 4.2+ replaced site/provider_network with scope); set with termination_id.",
    ),
  termination_id: z
    .number()
    .int()
    .optional()
    .describe(
      "Numeric id of the termination scope object (e.g. a site id or provider-network id).",
    ),
  port_speed: z.number().int().optional().describe("Port speed (kbps)."),
  upstream_speed: z.number().int().optional().describe("Upstream speed (kbps)."),
  xconnect_id: z.string().max(50).optional(),
  pp_info: z.string().max(100).optional(),
  mark_connected: z.boolean().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const circuitTermUpdate = {
  circuit: z.number().int().optional(),
  term_side: z.enum(["A", "Z"]).optional(),
  termination_type: z.enum(TERM_SCOPES).nullable().optional(),
  termination_id: z.number().int().nullable().optional(),
  port_speed: z.number().int().nullable().optional(),
  upstream_speed: z.number().int().nullable().optional(),
  xconnect_id: z.string().max(50).optional(),
  pp_info: z.string().max(100).optional(),
  mark_connected: z.boolean().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const circuitGroupCreate = {
  name: z.string().min(1).max(100).describe("Name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  tenant: z.number().int().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const circuitGroupUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  tenant: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const circuitGroupAsgnCreate = {
  group: z.number().int().describe("Circuit group id (required)."),
  member_type: z
    .string()
    .describe(
      "Member object type, e.g. 'circuits.circuit' or 'circuits.virtualcircuit' (required).",
    ),
  member_id: z.number().int().describe("Member object id (required)."),
  priority: z.enum(PRIORITY).optional(),
  tags: TagSlugsSchema,
};
const circuitGroupAsgnUpdate = {
  group: z.number().int().optional(),
  member_type: z.string().optional(),
  member_id: z.number().int().optional(),
  priority: z.enum(PRIORITY).nullable().optional(),
  tags: TagSlugsSchema,
};

const vCircuitCreate = {
  cid: z.string().min(1).max(100).describe("Virtual circuit ID (required)."),
  provider_network: z.number().int().describe("Provider network id (required)."),
  type: z.number().int().describe("Virtual circuit type id (required)."),
  status: z.enum(CIRCUIT_STATUS).default("active"),
  provider_account: z.number().int().optional(),
  tenant: z.number().int().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const vCircuitUpdate = {
  cid: z.string().min(1).max(100).optional(),
  provider_network: z.number().int().optional(),
  type: z.number().int().optional(),
  status: z.enum(CIRCUIT_STATUS).optional(),
  provider_account: z.number().int().nullable().optional(),
  tenant: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const vCircuitTypeCreate = {
  name: z.string().min(1).max(100).describe("Name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  color: z.string().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const vCircuitTypeUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  color: z.string().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const vCircuitTermCreate = {
  virtual_circuit: z.number().int().describe("Virtual circuit id (required)."),
  role: z.enum(["peer", "hub", "spoke"]).describe("Termination role (required)."),
  interface: z
    .number()
    .int()
    .describe("Device interface id this virtual circuit terminates on (required)."),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const vCircuitTermUpdate = {
  virtual_circuit: z.number().int().optional(),
  role: z.enum(["peer", "hub", "spoke"]).optional(),
  interface: z.number().int().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

export function registerCircuits(server: McpServer): void {
  const crud = (
    endpoint: string,
    singular: string,
    plural: string,
    description: string,
    filters: any,
    create: any,
    update: any,
    listFields?: string[],
  ) => {
    registerList(
      server,
      { endpoint, singular, plural, description, listFields },
      filters,
    );
    registerGet(server, { endpoint, singular, plural, description });
    registerCreate(server, { endpoint, singular, plural, description }, create);
    registerUpdate(server, { endpoint, singular, plural, description }, update);
  };
  crud(
    "circuits/providers",
    "provider",
    "providers",
    "circuit providers (carriers)",
    { name: z.string().optional(), slug: z.string().optional() },
    providerCreate,
    providerUpdate,
    ["name", "slug", "description"],
  );
  crud(
    "circuits/provider-accounts",
    "provider_account",
    "provider_accounts",
    "provider billing accounts",
    { provider_id: z.number().int().optional(), account: z.string().optional() },
    provAcctCreate,
    provAcctUpdate,
    ["account", "provider", "name"],
  );
  crud(
    "circuits/provider-networks",
    "provider_network",
    "provider_networks",
    "provider networks",
    { provider_id: z.number().int().optional(), name: z.string().optional() },
    provNetCreate,
    provNetUpdate,
    ["name", "provider", "service_id"],
  );
  crud(
    "circuits/circuit-types",
    "circuit_type",
    "circuit_types",
    "circuit types",
    { name: z.string().optional(), slug: z.string().optional() },
    circuitTypeCreate,
    circuitTypeUpdate,
    ["name", "slug", "color"],
  );
  crud(
    "circuits/circuits",
    "circuit",
    "circuits",
    "circuits (provider data links)",
    {
      cid: z.string().optional(),
      provider_id: z.number().int().optional(),
      type_id: z.number().int().optional(),
      status: z.string().optional(),
      tenant_id: z.number().int().optional(),
    },
    circuitCreate,
    circuitUpdate,
    ["cid", "provider", "type", "status"],
  );
  crud(
    "circuits/circuit-terminations",
    "circuit_termination",
    "circuit_terminations",
    "circuit terminations (A/Z endpoints)",
    { circuit_id: z.number().int().optional(), term_side: z.string().optional() },
    circuitTermCreate,
    circuitTermUpdate,
    ["circuit", "term_side", "termination", "port_speed"],
  );
  crud(
    "circuits/circuit-groups",
    "circuit_group",
    "circuit_groups",
    "circuit groups",
    { name: z.string().optional(), slug: z.string().optional() },
    circuitGroupCreate,
    circuitGroupUpdate,
    ["name", "slug", "tenant"],
  );
  crud(
    "circuits/circuit-group-assignments",
    "circuit_group_assignment",
    "circuit_group_assignments",
    "circuit group memberships",
    { group_id: z.number().int().optional() },
    circuitGroupAsgnCreate,
    circuitGroupAsgnUpdate,
    ["group", "member_type", "priority"],
  );
  crud(
    "circuits/virtual-circuits",
    "virtual_circuit",
    "virtual_circuits",
    "virtual circuits",
    {
      cid: z.string().optional(),
      provider_network_id: z.number().int().optional(),
      type_id: z.number().int().optional(),
    },
    vCircuitCreate,
    vCircuitUpdate,
    ["cid", "provider_network", "type", "status"],
  );
  crud(
    "circuits/virtual-circuit-types",
    "virtual_circuit_type",
    "virtual_circuit_types",
    "virtual circuit types",
    { name: z.string().optional(), slug: z.string().optional() },
    vCircuitTypeCreate,
    vCircuitTypeUpdate,
    ["name", "slug", "color"],
  );
  crud(
    "circuits/virtual-circuit-terminations",
    "virtual_circuit_termination",
    "virtual_circuit_terminations",
    "virtual circuit terminations",
    { virtual_circuit_id: z.number().int().optional() },
    vCircuitTermCreate,
    vCircuitTermUpdate,
    ["virtual_circuit", "role", "interface"],
  );
}
