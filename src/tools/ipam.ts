/**
 * IPAM tool registrations.
 *
 * Covers prefixes, IP addresses, VLANs, VLAN groups, VRFs, aggregates,
 * IP ranges, and roles. Full CRUD on prefixes/IPs/VLANs/VRFs; list+get
 * elsewhere.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  registerCreate,
  registerGet,
  registerList,
  registerUpdate,
} from "../registrars.js";
import { CustomFieldsSchema, TagSlugsSchema } from "../schemas/common.js";

const PREFIX_STATUS = ["container", "active", "reserved", "deprecated"] as const;
const IP_STATUS = ["active", "reserved", "deprecated", "dhcp", "slaac"] as const;
const IP_ROLE = [
  "loopback",
  "secondary",
  "anycast",
  "vip",
  "vrrp",
  "hsrp",
  "glbp",
  "carp",
] as const;
const VLAN_STATUS = ["active", "reserved", "deprecated"] as const;

/* ---------------- prefixes ---------------- */

const prefixFilters = {
  prefix: z.string().optional().describe("Exact CIDR match, e.g. '10.0.0.0/24'."),
  within: z
    .string()
    .optional()
    .describe("Return prefixes strictly contained within this CIDR (e.g. '10.0.0.0/8')."),
  within_include: z
    .string()
    .optional()
    .describe("Like 'within' but also includes the parent prefix."),
  contains: z
    .string()
    .optional()
    .describe("Return prefixes that contain this CIDR or IP."),
  family: z.union([z.literal(4), z.literal(6)]).optional().describe("4 or 6."),
  status: z.enum(PREFIX_STATUS).optional(),
  role_id: z.number().int().optional(),
  site_id: z.number().int().optional(),
  vrf_id: z.number().int().optional().describe("Numeric VRF id; 'null' also matches global."),
  tenant_id: z.number().int().optional(),
  mask_length: z.number().int().min(0).max(128).optional().describe("Exact prefix length."),
  is_pool: z.boolean().optional(),
  mark_utilized: z.boolean().optional(),
};

const prefixCreate = {
  prefix: z.string().describe("CIDR, e.g. '10.0.0.0/24' (required)."),
  status: z.enum(PREFIX_STATUS).default("active"),
  role: z.number().int().optional().describe("Prefix role id."),
  scope_type: z
    .enum(["dcim.site", "dcim.location", "dcim.region", "dcim.sitegroup"])
    .optional()
    .describe("Scope object type. NetBox 4.2+ replaced the prefix 'site' field with a generic scope; set together with scope_id."),
  scope_id: z.number().int().optional().describe("Numeric id of the scope object (e.g. the site id)."),
  vrf: z.number().int().optional().describe("VRF id; omit for the global table."),
  tenant: z.number().int().optional(),
  vlan: z.number().int().optional().describe("VLAN id this prefix belongs to."),
  is_pool: z.boolean().optional(),
  mark_utilized: z.boolean().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const prefixUpdate = {
  prefix: z.string().optional(),
  status: z.enum(PREFIX_STATUS).optional(),
  role: z.number().int().nullable().optional(),
  scope_type: z
    .enum(["dcim.site", "dcim.location", "dcim.region", "dcim.sitegroup"])
    .nullable()
    .optional()
    .describe("Scope object type (NetBox 4.2+ replaced 'site' with scope)."),
  scope_id: z.number().int().nullable().optional().describe("Numeric id of the scope object."),
  vrf: z.number().int().nullable().optional(),
  tenant: z.number().int().nullable().optional(),
  vlan: z.number().int().nullable().optional(),
  is_pool: z.boolean().optional(),
  mark_utilized: z.boolean().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ---------------- ip addresses ---------------- */

const ipAddressFilters = {
  address: z.string().optional().describe("Exact address with mask, e.g. '10.0.0.5/32'."),
  parent: z
    .string()
    .optional()
    .describe("Return addresses within this CIDR, e.g. '10.0.0.0/24'."),
  family: z.union([z.literal(4), z.literal(6)]).optional(),
  status: z.enum(IP_STATUS).optional(),
  role: z.enum(IP_ROLE).optional(),
  dns_name: z.string().optional(),
  vrf_id: z.number().int().optional(),
  tenant_id: z.number().int().optional(),
  assigned_to_interface: z.boolean().optional(),
  interface_id: z.number().int().optional().describe("Restrict to one device interface."),
  vminterface_id: z.number().int().optional().describe("Restrict to one VM interface."),
};

const ipAddressCreate = {
  address: z
    .string()
    .describe("Address in CIDR notation, e.g. '10.0.0.5/24' or '2001:db8::1/64' (required)."),
  status: z.enum(IP_STATUS).default("active"),
  role: z.enum(IP_ROLE).optional(),
  vrf: z.number().int().optional(),
  tenant: z.number().int().optional(),
  nat_inside: z.number().int().optional().describe("Numeric id of the inside (private) IP."),
  assigned_object_type: z
    .enum(["dcim.interface", "virtualization.vminterface"])
    .optional()
    .describe("Set together with assigned_object_id to attach to an interface."),
  assigned_object_id: z
    .number()
    .int()
    .optional()
    .describe("Numeric id of the interface/VM-interface when assigning."),
  dns_name: z.string().max(255).optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const ipAddressUpdate = {
  address: z.string().optional(),
  status: z.enum(IP_STATUS).optional(),
  role: z.enum(IP_ROLE).nullable().optional(),
  vrf: z.number().int().nullable().optional(),
  tenant: z.number().int().nullable().optional(),
  nat_inside: z.number().int().nullable().optional(),
  assigned_object_type: z
    .enum(["dcim.interface", "virtualization.vminterface"])
    .nullable()
    .optional(),
  assigned_object_id: z.number().int().nullable().optional(),
  dns_name: z.string().max(255).optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ---------------- vlans ---------------- */

const vlanFilters = {
  vid: z.number().int().min(1).max(4094).optional().describe("Exact VLAN id (1-4094)."),
  name: z.string().optional(),
  name__ic: z.string().optional().describe("Name contains (case-insensitive)."),
  status: z.enum(VLAN_STATUS).optional(),
  site_id: z.number().int().optional(),
  group_id: z.number().int().optional().describe("VLAN group id."),
  role_id: z.number().int().optional(),
  tenant_id: z.number().int().optional(),
};

const vlanCreate = {
  vid: z.number().int().min(1).max(4094).describe("VLAN id (1-4094, required)."),
  name: z.string().min(1).max(64).describe("VLAN name (required)."),
  status: z.enum(VLAN_STATUS).default("active"),
  site: z.number().int().optional(),
  group: z.number().int().optional(),
  role: z.number().int().optional(),
  tenant: z.number().int().optional(),
  qinq_role: z.enum(["svlan", "cvlan"]).optional().describe("Q-in-Q role (service vs customer VLAN)."),
  qinq_svlan: z.number().int().optional().describe("Q-in-Q service VLAN id (when this VLAN is a cvlan)."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const vlanUpdate = {
  vid: z.number().int().min(1).max(4094).optional(),
  name: z.string().min(1).max(64).optional(),
  status: z.enum(VLAN_STATUS).optional(),
  site: z.number().int().nullable().optional(),
  group: z.number().int().nullable().optional(),
  role: z.number().int().nullable().optional(),
  tenant: z.number().int().nullable().optional(),
  qinq_role: z.enum(["svlan", "cvlan"]).nullable().optional(),
  qinq_svlan: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ---------------- vlan groups ---------------- */

const vlanGroupFilters = {
  name: z.string().optional(),
  slug: z.string().optional(),
  scope_type: z
    .string()
    .optional()
    .describe("e.g. 'dcim.site', 'dcim.location', 'virtualization.cluster'."),
  scope_id: z.number().int().optional(),
};

/* ---------------- vrfs ---------------- */

const vrfFilters = {
  name: z.string().optional(),
  rd: z.string().optional().describe("Route distinguisher."),
  enforce_unique: z.boolean().optional(),
  tenant_id: z.number().int().optional(),
};

const vrfCreate = {
  name: z.string().min(1).max(100).describe("VRF name (required)."),
  rd: z.string().max(21).optional().describe("Route distinguisher."),
  enforce_unique: z.boolean().optional(),
  import_targets: z.array(z.number().int()).optional().describe("Array of route-target ids to import."),
  export_targets: z.array(z.number().int()).optional().describe("Array of route-target ids to export."),
  tenant: z.number().int().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const vrfUpdate = {
  name: z.string().min(1).max(100).optional(),
  rd: z.string().max(21).nullable().optional(),
  enforce_unique: z.boolean().optional(),
  import_targets: z.array(z.number().int()).optional().describe("Array of route-target ids to import."),
  export_targets: z.array(z.number().int()).optional().describe("Array of route-target ids to export."),
  tenant: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ---------------- aggregates ---------------- */

const aggregateFilters = {
  prefix: z.string().optional(),
  family: z.union([z.literal(4), z.literal(6)]).optional(),
  rir_id: z.number().int().optional().describe("RIR id (e.g. ARIN, RIPE)."),
  tenant_id: z.number().int().optional(),
};

/* ---------------- ip ranges ---------------- */

const ipRangeFilters = {
  start_address: z.string().optional(),
  end_address: z.string().optional(),
  family: z.union([z.literal(4), z.literal(6)]).optional(),
  vrf_id: z.number().int().optional(),
  tenant_id: z.number().int().optional(),
  status: z.enum(["active", "reserved", "deprecated"]).optional(),
  role_id: z.number().int().optional(),
};

/* ---------------- roles ---------------- */

const roleFilters = {
  name: z.string().optional(),
  slug: z.string().optional(),
};

/* ---------------- wire everything up ---------------- */

/* ---------------- write schemas for previously read-only resources ---------------- */

const IPAM_SLUG = /^[-a-zA-Z0-9_]+$/;
const IP_RANGE_STATUS = ["active", "reserved", "deprecated"] as const;
const VLAN_GROUP_SCOPES = [
  "dcim.region",
  "dcim.sitegroup",
  "dcim.site",
  "dcim.location",
  "dcim.rack",
  "virtualization.cluster",
  "virtualization.clustergroup",
] as const;

const vlanGroupCreate = {
  name: z.string().min(1).max(100).describe("VLAN group name (required)."),
  slug: z.string().min(1).max(100).regex(IPAM_SLUG).describe("URL-safe slug (required)."),
  scope_type: z.enum(VLAN_GROUP_SCOPES).optional().describe("Scope object type; set together with scope_id."),
  scope_id: z.number().int().optional().describe("Numeric id of the scope object."),
  vid_ranges: z
    .array(z.tuple([z.number().int().min(1).max(4094), z.number().int().min(1).max(4094)]))
    .optional()
    .describe("Allowed VLAN id ranges as [start, end] pairs, e.g. [[1,999],[2000,2999]]. NetBox 4.x replaced min_vid/max_vid with this. Defaults to [[1,4094]]."),
  tenant: z.number().int().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const vlanGroupUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(IPAM_SLUG).optional(),
  scope_type: z.enum(VLAN_GROUP_SCOPES).nullable().optional(),
  scope_id: z.number().int().nullable().optional(),
  vid_ranges: z
    .array(z.tuple([z.number().int().min(1).max(4094), z.number().int().min(1).max(4094)]))
    .optional(),
  tenant: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const aggregateCreate = {
  prefix: z.string().describe("Aggregate CIDR, e.g. '10.0.0.0/8' (required)."),
  rir: z.number().int().describe("RIR id (required, e.g. ARIN/RIPE)."),
  tenant: z.number().int().optional(),
  date_added: z.string().optional().describe("Date added (ISO-8601, YYYY-MM-DD)."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const aggregateUpdate = {
  prefix: z.string().optional(),
  rir: z.number().int().optional(),
  tenant: z.number().int().nullable().optional(),
  date_added: z.string().nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const ipRangeCreate = {
  start_address: z.string().describe("First address with mask, e.g. '10.0.0.10/24' (required)."),
  end_address: z.string().describe("Last address with mask, e.g. '10.0.0.20/24' (required)."),
  vrf: z.number().int().optional().describe("VRF id; omit for the global table."),
  tenant: z.number().int().optional(),
  role: z.number().int().optional().describe("IPAM role id."),
  status: z.enum(IP_RANGE_STATUS).default("active"),
  mark_utilized: z.boolean().optional().describe("Treat the entire range as fully utilized."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const ipRangeUpdate = {
  start_address: z.string().optional(),
  end_address: z.string().optional(),
  vrf: z.number().int().nullable().optional(),
  tenant: z.number().int().nullable().optional(),
  role: z.number().int().nullable().optional(),
  status: z.enum(IP_RANGE_STATUS).optional(),
  mark_utilized: z.boolean().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const ipamRoleCreate = {
  name: z.string().min(1).max(100).describe("Role name (required)."),
  slug: z.string().min(1).max(100).regex(IPAM_SLUG).describe("URL-safe slug (required)."),
  weight: z.number().int().optional().describe("Ordering weight (default 1000)."),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const ipamRoleUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(IPAM_SLUG).optional(),
  weight: z.number().int().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

export function registerIpam(server: McpServer): void {
  // prefixes
  registerList(server, {
    endpoint: "ipam/prefixes",
    singular: "prefix",
    plural: "prefixes",
    description: "IP prefixes (subnets)",
    listFields: [
      "prefix",
      "status",
      "vrf",
      "role",
      "site",
      "tenant",
      "is_pool",
      "description",
    ],
  }, prefixFilters);
  registerGet(server, {
    endpoint: "ipam/prefixes",
    singular: "prefix",
    plural: "prefixes",
    description: "IP prefixes",
  });
  registerCreate(server, {
    endpoint: "ipam/prefixes",
    singular: "prefix",
    plural: "prefixes",
    description: "IP prefixes",
  }, prefixCreate);
  registerUpdate(server, {
    endpoint: "ipam/prefixes",
    singular: "prefix",
    plural: "prefixes",
    description: "IP prefixes",
  }, prefixUpdate);

  // ip addresses
  registerList(server, {
    endpoint: "ipam/ip-addresses",
    singular: "ip_address",
    plural: "ip_addresses",
    description: "individual IP addresses",
    listFields: [
      "address",
      "status",
      "role",
      "vrf",
      "tenant",
      "assigned_object",
      "dns_name",
      "description",
    ],
  }, ipAddressFilters);
  registerGet(server, {
    endpoint: "ipam/ip-addresses",
    singular: "ip_address",
    plural: "ip_addresses",
    description: "individual IP addresses",
  });
  registerCreate(server, {
    endpoint: "ipam/ip-addresses",
    singular: "ip_address",
    plural: "ip_addresses",
    description: "individual IP addresses",
  }, ipAddressCreate);
  registerUpdate(server, {
    endpoint: "ipam/ip-addresses",
    singular: "ip_address",
    plural: "ip_addresses",
    description: "individual IP addresses",
  }, ipAddressUpdate);

  // vlans
  registerList(server, {
    endpoint: "ipam/vlans",
    singular: "vlan",
    plural: "vlans",
    description: "layer-2 VLANs",
    listFields: ["vid", "name", "status", "site", "group", "role", "tenant"],
  }, vlanFilters);
  registerGet(server, {
    endpoint: "ipam/vlans",
    singular: "vlan",
    plural: "vlans",
    description: "layer-2 VLANs",
  });
  registerCreate(server, {
    endpoint: "ipam/vlans",
    singular: "vlan",
    plural: "vlans",
    description: "layer-2 VLANs",
  }, vlanCreate);
  registerUpdate(server, {
    endpoint: "ipam/vlans",
    singular: "vlan",
    plural: "vlans",
    description: "layer-2 VLANs",
  }, vlanUpdate);

  // vlan groups (read-only)
  registerList(server, {
    endpoint: "ipam/vlan-groups",
    singular: "vlan_group",
    plural: "vlan_groups",
    description: "groupings of VLANs (enforce vid uniqueness within a scope)",
  }, vlanGroupFilters);
  registerGet(server, {
    endpoint: "ipam/vlan-groups",
    singular: "vlan_group",
    plural: "vlan_groups",
    description: "VLAN groups",
  });

  registerCreate(server, {
    endpoint: "ipam/vlan-groups",
    singular: "vlan_group",
    plural: "vlan_groups",
    description: "VLAN groups",
  }, vlanGroupCreate);
  registerUpdate(server, {
    endpoint: "ipam/vlan-groups",
    singular: "vlan_group",
    plural: "vlan_groups",
    description: "VLAN groups",
  }, vlanGroupUpdate);

  // vrfs
  registerList(server, {
    endpoint: "ipam/vrfs",
    singular: "vrf",
    plural: "vrfs",
    description: "VRFs (routing tables)",
    listFields: ["name", "rd", "enforce_unique", "tenant", "description"],
  }, vrfFilters);
  registerGet(server, {
    endpoint: "ipam/vrfs",
    singular: "vrf",
    plural: "vrfs",
    description: "VRFs",
  });
  registerCreate(server, {
    endpoint: "ipam/vrfs",
    singular: "vrf",
    plural: "vrfs",
    description: "VRFs",
  }, vrfCreate);
  registerUpdate(server, {
    endpoint: "ipam/vrfs",
    singular: "vrf",
    plural: "vrfs",
    description: "VRFs",
  }, vrfUpdate);

  // aggregates (read-only)
  registerList(server, {
    endpoint: "ipam/aggregates",
    singular: "aggregate",
    plural: "aggregates",
    description: "aggregate prefixes from RIRs",
  }, aggregateFilters);
  registerGet(server, {
    endpoint: "ipam/aggregates",
    singular: "aggregate",
    plural: "aggregates",
    description: "aggregate prefixes",
  });

  registerCreate(server, {
    endpoint: "ipam/aggregates",
    singular: "aggregate",
    plural: "aggregates",
    description: "aggregate prefixes",
  }, aggregateCreate);
  registerUpdate(server, {
    endpoint: "ipam/aggregates",
    singular: "aggregate",
    plural: "aggregates",
    description: "aggregate prefixes",
  }, aggregateUpdate);

  // ip ranges (read-only)
  registerList(server, {
    endpoint: "ipam/ip-ranges",
    singular: "ip_range",
    plural: "ip_ranges",
    description: "IP ranges (start/end address pairs)",
  }, ipRangeFilters);
  registerGet(server, {
    endpoint: "ipam/ip-ranges",
    singular: "ip_range",
    plural: "ip_ranges",
    description: "IP ranges",
  });

  registerCreate(server, {
    endpoint: "ipam/ip-ranges",
    singular: "ip_range",
    plural: "ip_ranges",
    description: "IP ranges",
  }, ipRangeCreate);
  registerUpdate(server, {
    endpoint: "ipam/ip-ranges",
    singular: "ip_range",
    plural: "ip_ranges",
    description: "IP ranges",
  }, ipRangeUpdate);

  // roles (read-only)
  registerList(server, {
    endpoint: "ipam/roles",
    singular: "role",
    plural: "roles",
    description: "IPAM role taxonomy (applied to prefixes/VLANs/IP ranges)",
  }, roleFilters);
  registerGet(server, {
    endpoint: "ipam/roles",
    singular: "role",
    plural: "roles",
    description: "IPAM roles",
  });

  registerCreate(server, {
    endpoint: "ipam/roles",
    singular: "role",
    plural: "roles",
    description: "IPAM roles",
  }, ipamRoleCreate);
  registerUpdate(server, {
    endpoint: "ipam/roles",
    singular: "role",
    plural: "roles",
    description: "IPAM roles",
  }, ipamRoleUpdate);
}
