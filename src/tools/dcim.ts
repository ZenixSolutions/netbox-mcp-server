/**
 * DCIM tool registrations.
 *
 * Covers sites, locations, racks, manufacturers, device types, device roles,
 * platforms, devices, interfaces, and cables. Full CRUD where it's useful
 * (sites, racks, devices, interfaces); list+get elsewhere.
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

/* ---------------- sites ---------------- */

const siteFilters = {
  name: z.string().optional().describe("Exact site name."),
  slug: z.string().optional().describe("Exact site slug."),
  status: z
    .enum(["planned", "staging", "active", "decommissioning", "retired"])
    .optional()
    .describe("Site status."),
  region_id: z.number().int().optional().describe("Filter by numeric region id."),
  group_id: z.number().int().optional().describe("Filter by numeric site group id."),
  tenant_id: z.number().int().optional().describe("Filter by numeric tenant id."),
  asn: z.string().optional().describe("Filter by legacy ASN number."),
};

const siteCreate = {
  name: z.string().min(1).max(100).describe("Human-readable name (required)."),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[-a-zA-Z0-9_]+$/)
    .describe("URL-safe slug (required, must be unique)."),
  status: z
    .enum(["planned", "staging", "active", "decommissioning", "retired"])
    .default("active")
    .describe("Status (default active)."),
  region: z.number().int().optional().describe("Region id."),
  group: z.number().int().optional().describe("Site group id."),
  tenant: z.number().int().optional().describe("Tenant id."),
  facility: z.string().max(50).optional().describe("Facility identifier at this site."),
  description: z.string().max(200).optional().describe("Short description."),
  physical_address: z.string().optional().describe("Physical mailing address."),
  shipping_address: z.string().optional().describe("Shipping address if different."),
  latitude: z.number().optional().describe("Decimal degrees latitude."),
  longitude: z.number().optional().describe("Decimal degrees longitude."),
  time_zone: z.string().optional().describe("IANA time zone (e.g. America/Los_Angeles)."),
  asns: z
    .array(z.number().int())
    .optional()
    .describe("Array of ASN object ids assigned to this site."),
  comments: z.string().optional().describe("Longer comments (Markdown)."),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const siteUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[-a-zA-Z0-9_]+$/)
    .optional(),
  status: z
    .enum(["planned", "staging", "active", "decommissioning", "retired"])
    .optional(),
  region: z.number().int().nullable().optional(),
  group: z.number().int().nullable().optional(),
  tenant: z.number().int().nullable().optional(),
  facility: z.string().max(50).optional(),
  description: z.string().max(200).optional(),
  physical_address: z.string().optional(),
  shipping_address: z.string().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  time_zone: z.string().nullable().optional(),
  asns: z.array(z.number().int()).optional().describe("Array of ASN object ids."),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ---------------- locations ---------------- */

const locationFilters = {
  name: z.string().optional().describe("Exact name."),
  slug: z.string().optional().describe("Exact slug."),
  site_id: z.number().int().optional().describe("Numeric site id."),
  parent_id: z
    .number()
    .int()
    .optional()
    .describe("Parent location id (for nested locations)."),
  status: z
    .enum(["planned", "staging", "active", "decommissioning", "retired"])
    .optional()
    .describe("Location status."),
};

/* ---------------- racks ---------------- */

const rackFilters = {
  name: z.string().optional().describe("Exact rack name."),
  site_id: z.number().int().optional().describe("Site id."),
  location_id: z.number().int().optional().describe("Location id."),
  status: z
    .enum(["reserved", "available", "planned", "active", "deprecated"])
    .optional()
    .describe("Rack status."),
  role_id: z.number().int().optional().describe("Rack role id."),
  tenant_id: z.number().int().optional().describe("Tenant id."),
  serial: z.string().optional().describe("Exact serial number."),
  asset_tag: z.string().optional().describe("Exact asset tag."),
};

const rackCreate = {
  name: z
    .string()
    .min(1)
    .max(100)
    .describe("Rack name (required, unique within site+location)."),
  site: z.number().int().describe("Site id (required)."),
  location: z.number().int().optional().describe("Location id."),
  status: z
    .enum(["reserved", "available", "planned", "active", "deprecated"])
    .default("active"),
  role: z.number().int().optional().describe("Rack role id."),
  tenant: z.number().int().optional().describe("Tenant id."),
  facility_id: z.string().max(50).optional().describe("Facility-assigned rack id."),
  serial: z.string().max(50).optional(),
  asset_tag: z.string().max(50).optional(),
  description: z
    .string()
    .max(200)
    .optional()
    .describe("Short description (distinct from the comments field)."),
  rack_type: z
    .number()
    .int()
    .optional()
    .describe(
      "Rack type id (a predefined rack model). Alternative to setting form_factor/width/u_height individually.",
    ),
  form_factor: z
    .string()
    .optional()
    .describe(
      "Rack form factor: 2-post-frame, 4-post-frame, 4-post-cabinet, wall-frame, wall-frame-vertical, wall-cabinet, wall-cabinet-vertical.",
    ),
  width: z
    .union([z.literal(10), z.literal(19), z.literal(21), z.literal(23)])
    .optional()
    .describe("Rail-to-rail width in inches."),
  u_height: z.number().int().min(1).max(100).optional().describe("Height in rack units."),
  starting_unit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Unit number of the bottom position."),
  desc_units: z.boolean().optional().describe("Number rack units descending."),
  weight: z.number().optional().describe("Rack weight."),
  max_weight: z.number().int().optional().describe("Maximum load capacity."),
  weight_unit: z.enum(["kg", "g", "lb", "oz"]).optional(),
  outer_width: z.number().int().min(0).optional(),
  outer_height: z.number().int().min(0).optional(),
  outer_depth: z.number().int().min(0).optional(),
  outer_unit: z.enum(["mm", "in"]).optional(),
  mounting_depth: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Maximum depth of a mounted device, in mm."),
  airflow: z
    .string()
    .optional()
    .describe(
      "Airflow direction: front-to-rear, rear-to-front, left-to-right, right-to-left, side-to-rear, passive, mixed.",
    ),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const rackUpdate = {
  name: z.string().min(1).max(100).optional(),
  site: z.number().int().optional(),
  location: z.number().int().nullable().optional(),
  status: z.enum(["reserved", "available", "planned", "active", "deprecated"]).optional(),
  role: z.number().int().nullable().optional(),
  tenant: z.number().int().nullable().optional(),
  facility_id: z.string().max(50).nullable().optional(),
  serial: z.string().max(50).optional(),
  asset_tag: z.string().max(50).nullable().optional(),
  description: z
    .string()
    .max(200)
    .optional()
    .describe("Short description (distinct from the comments field)."),
  rack_type: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe("Rack type id (predefined rack model)."),
  form_factor: z
    .string()
    .nullable()
    .optional()
    .describe("Rack form factor, e.g. 4-post-cabinet."),
  width: z.union([z.literal(10), z.literal(19), z.literal(21), z.literal(23)]).optional(),
  u_height: z.number().int().min(1).max(100).optional(),
  starting_unit: z.number().int().min(1).optional(),
  desc_units: z.boolean().optional(),
  weight: z.number().nullable().optional(),
  max_weight: z.number().int().nullable().optional(),
  weight_unit: z.enum(["kg", "g", "lb", "oz"]).nullable().optional(),
  outer_width: z.number().int().min(0).nullable().optional(),
  outer_height: z.number().int().min(0).nullable().optional(),
  outer_depth: z.number().int().min(0).nullable().optional(),
  outer_unit: z.enum(["mm", "in"]).nullable().optional(),
  mounting_depth: z.number().int().min(0).nullable().optional(),
  airflow: z.string().nullable().optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ---------------- manufacturers ---------------- */

const manufacturerFilters = {
  name: z.string().optional().describe("Exact name."),
  slug: z.string().optional().describe("Exact slug."),
};

/* ---------------- device types ---------------- */

const deviceTypeFilters = {
  model: z.string().optional().describe("Exact model name."),
  slug: z.string().optional().describe("Exact slug."),
  manufacturer_id: z.number().int().optional().describe("Manufacturer id."),
  part_number: z.string().optional().describe("Manufacturer part number."),
  u_height: z.number().optional().describe("Exact height in rack units."),
  is_full_depth: z
    .boolean()
    .optional()
    .describe("Only full-depth (true) or half-depth (false)."),
};

/* ---------------- device roles ---------------- */

const deviceRoleFilters = {
  name: z.string().optional().describe("Exact name."),
  slug: z.string().optional().describe("Exact slug."),
  vm_role: z.boolean().optional().describe("Whether this role applies to VMs."),
};

/* ---------------- platforms ---------------- */

const platformFilters = {
  name: z.string().optional().describe("Exact name."),
  slug: z.string().optional().describe("Exact slug."),
  manufacturer_id: z.number().int().optional().describe("Restrict to one manufacturer."),
};

/* ---------------- devices ---------------- */

const deviceFilters = {
  name: z.string().optional().describe("Exact device name (case-insensitive)."),
  name__ic: z.string().optional().describe("Device name contains (case-insensitive)."),
  serial: z.string().optional().describe("Exact serial number."),
  asset_tag: z.string().optional().describe("Exact asset tag."),
  site_id: z.number().int().optional(),
  location_id: z.number().int().optional(),
  rack_id: z.number().int().optional(),
  role_id: z.number().int().optional(),
  manufacturer_id: z.number().int().optional(),
  device_type_id: z.number().int().optional(),
  platform_id: z.number().int().optional(),
  tenant_id: z.number().int().optional(),
  status: z
    .enum([
      "offline",
      "active",
      "planned",
      "staged",
      "failed",
      "inventory",
      "decommissioning",
    ])
    .optional(),
  mac_address: z
    .string()
    .optional()
    .describe("Filter by any interface MAC (lowercase colon form)."),
  has_primary_ip: z.boolean().optional(),
};

const deviceCreate = {
  name: z
    .string()
    .max(64)
    .optional()
    .describe("Device name (may be null for some device types)."),
  device_type: z.number().int().describe("Device type id (required)."),
  role: z.number().int().describe("Device role id (required)."),
  site: z.number().int().describe("Site id (required)."),
  location: z.number().int().optional(),
  rack: z.number().int().optional(),
  position: z.number().optional().describe("Rack position in U."),
  face: z.enum(["front", "rear"]).optional().describe("Rack face."),
  status: z
    .enum([
      "offline",
      "active",
      "planned",
      "staged",
      "failed",
      "inventory",
      "decommissioning",
    ])
    .default("active"),
  platform: z.number().int().optional(),
  tenant: z.number().int().optional(),
  serial: z.string().max(50).optional(),
  asset_tag: z.string().max(50).optional(),
  primary_ip4: z.number().int().optional().describe("IP address id for primary IPv4."),
  primary_ip6: z.number().int().optional().describe("IP address id for primary IPv6."),
  cluster: z.number().int().optional().describe("Cluster id if this is a host."),
  oob_ip: z
    .number()
    .int()
    .optional()
    .describe("IP address id for the out-of-band (OOB) management IP."),
  airflow: z
    .string()
    .optional()
    .describe(
      "Airflow direction: front-to-rear, rear-to-front, left-to-right, right-to-left, passive, mixed.",
    ),
  virtual_chassis: z.number().int().optional().describe("Virtual chassis id."),
  vc_position: z
    .number()
    .int()
    .min(0)
    .max(255)
    .optional()
    .describe("Position within the virtual chassis."),
  vc_priority: z
    .number()
    .int()
    .min(0)
    .max(255)
    .optional()
    .describe("Virtual chassis master election priority."),
  latitude: z.number().optional().describe("GPS latitude (decimal degrees)."),
  longitude: z.number().optional().describe("GPS longitude (decimal degrees)."),
  config_template: z.number().int().optional().describe("Config template id."),
  local_context_data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Local config context data (JSON object)."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const deviceUpdate = {
  name: z.string().max(64).nullable().optional(),
  device_type: z.number().int().optional(),
  role: z.number().int().optional(),
  site: z.number().int().optional(),
  location: z.number().int().nullable().optional(),
  rack: z.number().int().nullable().optional(),
  position: z.number().nullable().optional(),
  face: z.enum(["front", "rear"]).nullable().optional(),
  status: z
    .enum([
      "offline",
      "active",
      "planned",
      "staged",
      "failed",
      "inventory",
      "decommissioning",
    ])
    .optional(),
  platform: z.number().int().nullable().optional(),
  tenant: z.number().int().nullable().optional(),
  serial: z.string().max(50).optional(),
  asset_tag: z.string().max(50).nullable().optional(),
  primary_ip4: z.number().int().nullable().optional(),
  primary_ip6: z.number().int().nullable().optional(),
  cluster: z.number().int().nullable().optional(),
  oob_ip: z.number().int().nullable().optional(),
  airflow: z.string().nullable().optional(),
  virtual_chassis: z.number().int().nullable().optional(),
  vc_position: z.number().int().min(0).max(255).nullable().optional(),
  vc_priority: z.number().int().min(0).max(255).nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  config_template: z.number().int().nullable().optional(),
  local_context_data: z.record(z.string(), z.unknown()).nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ---------------- interfaces ---------------- */

const interfaceFilters = {
  device_id: z.number().int().optional().describe("Numeric device id."),
  device: z.string().optional().describe("Device name."),
  name: z.string().optional().describe("Exact interface name."),
  name__ic: z.string().optional().describe("Interface name contains (case-insensitive)."),
  type: z
    .string()
    .optional()
    .describe(
      "Interface type slug, e.g. '1000base-t', '10gbase-x-sfpp', 'virtual', 'lag'.",
    ),
  enabled: z.boolean().optional(),
  mgmt_only: z.boolean().optional(),
  mac_address: z.string().optional().describe("Exact MAC (lowercase colon form)."),
  mode: z.enum(["access", "tagged", "tagged-all"]).optional().describe("802.1Q mode."),
  vlan_id: z.number().int().optional().describe("Tagged/untagged VLAN id match."),
};

const interfaceCreate = {
  device_id: z
    .number()
    .int()
    .describe(
      "Device id (required). Exposed as device_id (not device) because the remote-devices bridge reserves the name device; the server maps it back to the NetBox API field device on write.",
    ),
  name: z.string().min(1).max(64).describe("Interface name (required)."),
  type: z
    .string()
    .describe("Interface type slug, e.g. '1000base-t', 'virtual', 'lag' (required)."),
  enabled: z.boolean().default(true),
  label: z.string().max(64).optional(),
  mtu: z.number().int().min(1).max(65536).optional(),
  mac_address: z.string().optional(),
  mgmt_only: z.boolean().optional(),
  description: z.string().max(200).optional(),
  mode: z.enum(["access", "tagged", "tagged-all"]).optional(),
  untagged_vlan: z
    .number()
    .int()
    .optional()
    .describe("VLAN id for access / native VLAN."),
  tagged_vlans: z
    .array(z.number().int())
    .optional()
    .describe("Array of VLAN ids for trunks."),
  lag: z.number().int().optional().describe("Parent LAG interface id."),
  parent: z.number().int().optional().describe("Parent interface id for subinterfaces."),
  bridge: z.number().int().optional(),
  module: z.number().int().optional().describe("Module id this interface belongs to."),
  speed: z.number().int().optional().describe("Interface speed in kbps."),
  duplex: z.enum(["half", "full", "auto"]).optional(),
  wwn: z.string().optional().describe("World Wide Name (Fibre Channel)."),
  mark_connected: z
    .boolean()
    .optional()
    .describe("Treat as connected even without a cable."),
  poe_mode: z.enum(["pd", "pse"]).optional().describe("PoE mode."),
  poe_type: z.string().optional().describe("PoE type slug, e.g. type1-ieee802.3af."),
  vrf: z.number().int().optional().describe("VRF id bound to this interface."),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const interfaceUpdate = {
  name: z.string().min(1).max(64).optional(),
  type: z.string().optional(),
  enabled: z.boolean().optional(),
  label: z.string().max(64).optional(),
  mtu: z.number().int().min(1).max(65536).nullable().optional(),
  mac_address: z.string().nullable().optional(),
  mgmt_only: z.boolean().optional(),
  description: z.string().max(200).optional(),
  mode: z.enum(["access", "tagged", "tagged-all"]).nullable().optional(),
  untagged_vlan: z.number().int().nullable().optional(),
  tagged_vlans: z.array(z.number().int()).optional(),
  lag: z.number().int().nullable().optional(),
  parent: z.number().int().nullable().optional(),
  bridge: z.number().int().nullable().optional(),
  module: z.number().int().nullable().optional(),
  speed: z.number().int().nullable().optional(),
  duplex: z.enum(["half", "full", "auto"]).nullable().optional(),
  wwn: z.string().nullable().optional(),
  mark_connected: z.boolean().optional(),
  poe_mode: z.enum(["pd", "pse"]).nullable().optional(),
  poe_type: z.string().nullable().optional(),
  vrf: z.number().int().nullable().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ---------------- cables ---------------- */

const cableFilters = {
  status: z.enum(["connected", "planned", "decommissioning"]).optional(),
  type: z
    .string()
    .optional()
    .describe("Cable type slug (e.g. 'cat6', 'smf', 'mmf-om4')."),
  label: z.string().optional(),
  color: z.string().optional().describe("Hex color without the #."),
  length: z.number().optional(),
  length_unit: z.enum(["km", "m", "cm", "mi", "ft", "in"]).optional(),
  tenant_id: z.number().int().optional(),
};

/* ---------------- wire everything up ---------------- */

/* ---------------- write schemas for previously read-only resources ---------------- */

const DCIM_SLUG = /^[-a-zA-Z0-9_]+$/;
const LOCATION_STATUS = [
  "planned",
  "staging",
  "active",
  "decommissioning",
  "retired",
] as const;
const WEIGHT_UNITS = ["kg", "g", "lb", "oz"] as const;
const DT_AIRFLOW =
  "Airflow direction: front-to-rear, rear-to-front, left-to-right, right-to-left, side-to-rear, passive, mixed.";

const locationCreate = {
  name: z.string().min(1).max(100).describe("Location name (required)."),
  slug: z.string().min(1).max(100).regex(DCIM_SLUG).describe("URL-safe slug (required)."),
  site: z.number().int().describe("Site id (required)."),
  parent: z
    .number()
    .int()
    .optional()
    .describe("Parent location id (for nested locations)."),
  status: z.enum(LOCATION_STATUS).default("active"),
  tenant: z.number().int().optional().describe("Tenant id."),
  facility: z.string().max(50).optional().describe("Facility identifier."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const locationUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(DCIM_SLUG).optional(),
  site: z.number().int().optional(),
  parent: z.number().int().nullable().optional(),
  status: z.enum(LOCATION_STATUS).optional(),
  tenant: z.number().int().nullable().optional(),
  facility: z.string().max(50).optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const manufacturerCreate = {
  name: z.string().min(1).max(100).describe("Manufacturer name (required)."),
  slug: z.string().min(1).max(100).regex(DCIM_SLUG).describe("URL-safe slug (required)."),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const manufacturerUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(DCIM_SLUG).optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const deviceTypeCreate = {
  manufacturer: z.number().int().describe("Manufacturer id (required)."),
  model: z.string().min(1).max(100).describe("Model name (required)."),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(DCIM_SLUG)
    .describe("URL-safe slug (required, unique per manufacturer)."),
  default_platform: z.number().int().optional().describe("Default platform id."),
  part_number: z.string().max(50).optional().describe("Discrete part number."),
  u_height: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Height in rack units (0.5 increments allowed)."),
  is_full_depth: z
    .boolean()
    .optional()
    .describe("Consumes both front and rear rack faces."),
  exclude_from_utilization: z
    .boolean()
    .optional()
    .describe("Exclude instances from rack utilization calculations."),
  subdevice_role: z
    .enum(["parent", "child"])
    .optional()
    .describe("For modular chassis: 'parent' or 'child'."),
  airflow: z.string().optional().describe(DT_AIRFLOW),
  weight: z.number().optional(),
  weight_unit: z.enum(WEIGHT_UNITS).optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const deviceTypeUpdate = {
  manufacturer: z.number().int().optional(),
  model: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(DCIM_SLUG).optional(),
  default_platform: z.number().int().nullable().optional(),
  part_number: z.string().max(50).optional(),
  u_height: z.number().min(0).max(100).optional(),
  is_full_depth: z.boolean().optional(),
  exclude_from_utilization: z.boolean().optional(),
  subdevice_role: z.enum(["parent", "child"]).nullable().optional(),
  airflow: z.string().nullable().optional(),
  weight: z.number().nullable().optional(),
  weight_unit: z.enum(WEIGHT_UNITS).nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const deviceRoleCreate = {
  name: z.string().min(1).max(100).describe("Role name (required)."),
  slug: z.string().min(1).max(100).regex(DCIM_SLUG).describe("URL-safe slug (required)."),
  color: z.string().optional().describe("Hex color without '#', e.g. '4caf50'."),
  vm_role: z
    .boolean()
    .optional()
    .describe("Whether this role can be assigned to virtual machines."),
  config_template: z.number().int().optional().describe("Config template id."),
  parent: z
    .number()
    .int()
    .optional()
    .describe("Parent role id (device roles are nestable in NetBox 4.3+)."),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const deviceRoleUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(DCIM_SLUG).optional(),
  color: z.string().optional(),
  vm_role: z.boolean().optional(),
  config_template: z.number().int().nullable().optional(),
  parent: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const platformCreate = {
  name: z.string().min(1).max(100).describe("Platform name (required)."),
  slug: z.string().min(1).max(100).regex(DCIM_SLUG).describe("URL-safe slug (required)."),
  manufacturer: z
    .number()
    .int()
    .optional()
    .describe("Limit this platform to one manufacturer (optional)."),
  config_template: z.number().int().optional().describe("Config template id."),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const platformUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(DCIM_SLUG).optional(),
  manufacturer: z.number().int().nullable().optional(),
  config_template: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const CABLE_STATUS = ["connected", "planned", "decommissioning"] as const;
const CABLE_LENGTH_UNITS = ["km", "m", "cm", "mi", "ft", "in"] as const;
const CableTermination = z.object({
  object_type: z
    .string()
    .describe(
      "Termination object type, e.g. 'dcim.interface', 'dcim.frontport', 'dcim.rearport', 'dcim.consoleport', 'dcim.powerport', 'dcim.poweroutlet', 'dcim.powerfeed', 'circuits.circuittermination'. Power cabling: dcim.powerfeed->dcim.powerport (feed to PDU inlet) and dcim.poweroutlet->dcim.powerport (PDU outlet to device PSU).",
    ),
  object_id: z.number().int().describe("Numeric id of the termination object."),
});
const cableCreate = {
  a_terminations: z
    .array(CableTermination)
    .optional()
    .describe(
      "A-side terminations (usually one). Required to actually connect the cable to endpoints.",
    ),
  b_terminations: z
    .array(CableTermination)
    .optional()
    .describe("B-side terminations (usually one)."),
  type: z
    .string()
    .optional()
    .describe("Cable type slug, e.g. 'cat6', 'smf', 'mmf-om4', 'dac-passive'."),
  status: z.enum(CABLE_STATUS).default("connected"),
  tenant: z.number().int().optional(),
  label: z.string().max(100).optional(),
  color: z.string().optional().describe("Hex color without '#'."),
  length: z.number().optional(),
  length_unit: z.enum(CABLE_LENGTH_UNITS).optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const cableUpdate = {
  a_terminations: z.array(CableTermination).optional(),
  b_terminations: z.array(CableTermination).optional(),
  type: z.string().nullable().optional(),
  status: z.enum(CABLE_STATUS).optional(),
  tenant: z.number().int().nullable().optional(),
  label: z.string().max(100).optional(),
  color: z.string().optional(),
  length: z.number().nullable().optional(),
  length_unit: z.enum(CABLE_LENGTH_UNITS).nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

export function registerDcim(server: McpServer): void {
  // sites
  registerList(
    server,
    {
      endpoint: "dcim/sites",
      singular: "site",
      plural: "sites",
      description: "physical sites (datacenters, offices, POPs)",
    },
    siteFilters,
  );
  registerGet(server, {
    endpoint: "dcim/sites",
    singular: "site",
    plural: "sites",
    description: "physical sites",
  });
  registerCreate(
    server,
    {
      endpoint: "dcim/sites",
      singular: "site",
      plural: "sites",
      description: "physical sites",
    },
    siteCreate,
  );
  registerUpdate(
    server,
    {
      endpoint: "dcim/sites",
      singular: "site",
      plural: "sites",
      description: "physical sites",
    },
    siteUpdate,
  );

  // locations (read-only)
  registerList(
    server,
    {
      endpoint: "dcim/locations",
      singular: "location",
      plural: "locations",
      description: "locations within a site (rooms, floors, cages)",
    },
    locationFilters,
  );
  registerGet(server, {
    endpoint: "dcim/locations",
    singular: "location",
    plural: "locations",
    description: "locations within a site",
  });

  registerCreate(
    server,
    {
      endpoint: "dcim/locations",
      singular: "location",
      plural: "locations",
      description: "locations within a site",
    },
    locationCreate,
  );
  registerUpdate(
    server,
    {
      endpoint: "dcim/locations",
      singular: "location",
      plural: "locations",
      description: "locations within a site",
    },
    locationUpdate,
  );

  // racks
  registerList(
    server,
    {
      endpoint: "dcim/racks",
      singular: "rack",
      plural: "racks",
      description: "equipment racks",
    },
    rackFilters,
  );
  registerGet(server, {
    endpoint: "dcim/racks",
    singular: "rack",
    plural: "racks",
    description: "equipment racks",
  });
  registerCreate(
    server,
    {
      endpoint: "dcim/racks",
      singular: "rack",
      plural: "racks",
      description: "equipment racks",
    },
    rackCreate,
  );
  registerUpdate(
    server,
    {
      endpoint: "dcim/racks",
      singular: "rack",
      plural: "racks",
      description: "equipment racks",
    },
    rackUpdate,
  );

  // manufacturers (read-only)
  registerList(
    server,
    {
      endpoint: "dcim/manufacturers",
      singular: "manufacturer",
      plural: "manufacturers",
      description: "hardware manufacturers",
    },
    manufacturerFilters,
  );
  registerGet(server, {
    endpoint: "dcim/manufacturers",
    singular: "manufacturer",
    plural: "manufacturers",
    description: "hardware manufacturers",
  });

  registerCreate(
    server,
    {
      endpoint: "dcim/manufacturers",
      singular: "manufacturer",
      plural: "manufacturers",
      description: "hardware manufacturers",
    },
    manufacturerCreate,
  );
  registerUpdate(
    server,
    {
      endpoint: "dcim/manufacturers",
      singular: "manufacturer",
      plural: "manufacturers",
      description: "hardware manufacturers",
    },
    manufacturerUpdate,
  );

  // device types (read-only)
  registerList(
    server,
    {
      endpoint: "dcim/device-types",
      singular: "device_type",
      plural: "device_types",
      description: "device models (combinations of manufacturer + model)",
    },
    deviceTypeFilters,
  );
  registerGet(server, {
    endpoint: "dcim/device-types",
    singular: "device_type",
    plural: "device_types",
    description: "device models",
  });

  registerCreate(
    server,
    {
      endpoint: "dcim/device-types",
      singular: "device_type",
      plural: "device_types",
      description: "device models",
    },
    deviceTypeCreate,
  );
  registerUpdate(
    server,
    {
      endpoint: "dcim/device-types",
      singular: "device_type",
      plural: "device_types",
      description: "device models",
    },
    deviceTypeUpdate,
  );

  // device roles (read-only)
  registerList(
    server,
    {
      endpoint: "dcim/device-roles",
      singular: "device_role",
      plural: "device_roles",
      description: "device roles (core-switch, leaf, hypervisor, etc.)",
    },
    deviceRoleFilters,
  );
  registerGet(server, {
    endpoint: "dcim/device-roles",
    singular: "device_role",
    plural: "device_roles",
    description: "device roles",
  });

  registerCreate(
    server,
    {
      endpoint: "dcim/device-roles",
      singular: "device_role",
      plural: "device_roles",
      description: "device roles",
    },
    deviceRoleCreate,
  );
  registerUpdate(
    server,
    {
      endpoint: "dcim/device-roles",
      singular: "device_role",
      plural: "device_roles",
      description: "device roles",
    },
    deviceRoleUpdate,
  );

  // platforms (read-only)
  registerList(
    server,
    {
      endpoint: "dcim/platforms",
      singular: "platform",
      plural: "platforms",
      description: "OS platforms (e.g. EOS, NX-OS, Junos)",
    },
    platformFilters,
  );
  registerGet(server, {
    endpoint: "dcim/platforms",
    singular: "platform",
    plural: "platforms",
    description: "OS platforms",
  });

  registerCreate(
    server,
    {
      endpoint: "dcim/platforms",
      singular: "platform",
      plural: "platforms",
      description: "OS platforms",
    },
    platformCreate,
  );
  registerUpdate(
    server,
    {
      endpoint: "dcim/platforms",
      singular: "platform",
      plural: "platforms",
      description: "OS platforms",
    },
    platformUpdate,
  );

  // devices
  registerList(
    server,
    {
      endpoint: "dcim/devices",
      singular: "device",
      plural: "devices",
      description: "physical devices (switches, routers, servers, firewalls, etc.)",
      listFields: [
        "name",
        "device_type",
        "role",
        "site",
        "location",
        "rack",
        "position",
        "status",
        "primary_ip",
        "serial",
        "tenant",
      ],
    },
    deviceFilters,
  );
  registerGet(server, {
    endpoint: "dcim/devices",
    singular: "device",
    plural: "devices",
    description: "physical devices",
  });
  registerCreate(
    server,
    {
      endpoint: "dcim/devices",
      singular: "device",
      plural: "devices",
      description: "physical devices",
    },
    deviceCreate,
  );
  registerUpdate(
    server,
    {
      endpoint: "dcim/devices",
      singular: "device",
      plural: "devices",
      description: "physical devices",
    },
    deviceUpdate,
  );

  // interfaces
  registerList(
    server,
    {
      endpoint: "dcim/interfaces",
      singular: "interface",
      plural: "interfaces",
      description: "device interfaces (physical, virtual, LAG)",
      listFields: [
        "name",
        "device",
        "type",
        "enabled",
        "mgmt_only",
        "mac_address",
        "mode",
        "mtu",
        "description",
      ],
    },
    interfaceFilters,
  );
  registerGet(server, {
    endpoint: "dcim/interfaces",
    singular: "interface",
    plural: "interfaces",
    description: "device interfaces",
  });
  registerCreate(
    server,
    {
      endpoint: "dcim/interfaces",
      singular: "interface",
      plural: "interfaces",
      description: "device interfaces",
    },
    interfaceCreate,
  );
  registerUpdate(
    server,
    {
      endpoint: "dcim/interfaces",
      singular: "interface",
      plural: "interfaces",
      description: "device interfaces",
    },
    interfaceUpdate,
  );

  // cables (read-only)
  registerList(
    server,
    {
      endpoint: "dcim/cables",
      singular: "cable",
      plural: "cables",
      description: "cables connecting two endpoints",
    },
    cableFilters,
  );
  registerGet(server, {
    endpoint: "dcim/cables",
    singular: "cable",
    plural: "cables",
    description: "cables",
  });

  registerCreate(
    server,
    {
      endpoint: "dcim/cables",
      singular: "cable",
      plural: "cables",
      description: "cables",
    },
    cableCreate,
  );
  registerUpdate(
    server,
    {
      endpoint: "dcim/cables",
      singular: "cable",
      plural: "cables",
      description: "cables",
    },
    cableUpdate,
  );
}
