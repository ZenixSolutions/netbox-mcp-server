/**
 * DCIM organizational tools: regions, site groups, rack roles, rack types,
 * rack reservations. (Wave 1 of full-coverage expansion.)
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

const SLUG = /^[-a-zA-Z0-9_]+$/;
const WEIGHT_UNITS = ["kg", "g", "lb", "oz"] as const;

/* regions */
const regionFilters = {
  name: z.string().optional(),
  slug: z.string().optional(),
  parent_id: z.number().int().optional().describe("Parent region id."),
};
const regionCreate = {
  name: z.string().min(1).max(100).describe("Region name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  parent: z
    .number()
    .int()
    .optional()
    .describe("Parent region id (regions are nestable)."),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const regionUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  parent: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* site groups */
const siteGroupFilters = {
  name: z.string().optional(),
  slug: z.string().optional(),
  parent_id: z.number().int().optional(),
};
const siteGroupCreate = { ...regionCreate };
const siteGroupUpdate = { ...regionUpdate };

/* rack roles */
const rackRoleFilters = { name: z.string().optional(), slug: z.string().optional() };
const rackRoleCreate = {
  name: z.string().min(1).max(100).describe("Rack role name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  color: z.string().optional().describe("Hex color without '#'."),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const rackRoleUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  color: z.string().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* rack types */
const rackTypeFilters = {
  manufacturer_id: z.number().int().optional(),
  model: z.string().optional(),
  slug: z.string().optional(),
};
const rackTypeCreate = {
  manufacturer: z.number().int().describe("Manufacturer id (required)."),
  model: z.string().min(1).max(100).describe("Model name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  form_factor: z
    .string()
    .optional()
    .describe(
      "2-post-frame, 4-post-frame, 4-post-cabinet, wall-frame, wall-frame-vertical, wall-cabinet, wall-cabinet-vertical.",
    ),
  width: z.union([z.literal(10), z.literal(19), z.literal(21), z.literal(23)]).optional(),
  u_height: z.number().int().min(1).max(100).optional(),
  starting_unit: z.number().int().min(1).optional(),
  desc_units: z.boolean().optional(),
  outer_width: z.number().int().min(0).optional(),
  outer_height: z.number().int().min(0).optional(),
  outer_depth: z.number().int().min(0).optional(),
  outer_unit: z.enum(["mm", "in"]).optional(),
  mounting_depth: z.number().int().min(0).optional(),
  weight: z.number().optional(),
  max_weight: z.number().int().optional(),
  weight_unit: z.enum(WEIGHT_UNITS).optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const rackTypeUpdate = {
  manufacturer: z.number().int().optional(),
  model: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  form_factor: z.string().nullable().optional(),
  width: z.union([z.literal(10), z.literal(19), z.literal(21), z.literal(23)]).optional(),
  u_height: z.number().int().min(1).max(100).optional(),
  starting_unit: z.number().int().min(1).optional(),
  desc_units: z.boolean().optional(),
  outer_width: z.number().int().min(0).nullable().optional(),
  outer_height: z.number().int().min(0).nullable().optional(),
  outer_depth: z.number().int().min(0).nullable().optional(),
  outer_unit: z.enum(["mm", "in"]).nullable().optional(),
  mounting_depth: z.number().int().min(0).nullable().optional(),
  weight: z.number().nullable().optional(),
  max_weight: z.number().int().nullable().optional(),
  weight_unit: z.enum(WEIGHT_UNITS).nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* rack reservations */
const rackReservationFilters = {
  rack_id: z.number().int().optional(),
  user_id: z.number().int().optional(),
  tenant_id: z.number().int().optional(),
};
const rackReservationCreate = {
  rack: z.number().int().describe("Rack id (required)."),
  units: z
    .array(z.number().int())
    .describe("Array of rack unit numbers to reserve (required), e.g. [1,2,3]."),
  user: z.number().int().describe("User id who owns the reservation (required)."),
  description: z.string().min(1).max(200).describe("Reservation description (required)."),
  tenant: z.number().int().optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const rackReservationUpdate = {
  rack: z.number().int().optional(),
  units: z.array(z.number().int()).optional(),
  user: z.number().int().optional(),
  description: z.string().min(1).max(200).optional(),
  tenant: z.number().int().nullable().optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

export function registerDcimOrg(server: McpServer): void {
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
    "dcim/regions",
    "region",
    "regions",
    "geographic regions (nestable)",
    regionFilters,
    regionCreate,
    regionUpdate,
    ["name", "slug", "parent", "description"],
  );
  crud(
    "dcim/site-groups",
    "site_group",
    "site_groups",
    "functional site groups (nestable)",
    siteGroupFilters,
    siteGroupCreate,
    siteGroupUpdate,
    ["name", "slug", "parent", "description"],
  );
  crud(
    "dcim/rack-roles",
    "rack_role",
    "rack_roles",
    "rack roles",
    rackRoleFilters,
    rackRoleCreate,
    rackRoleUpdate,
    ["name", "slug", "color", "description"],
  );
  crud(
    "dcim/rack-types",
    "rack_type",
    "rack_types",
    "predefined rack models",
    rackTypeFilters,
    rackTypeCreate,
    rackTypeUpdate,
    ["model", "slug", "manufacturer", "form_factor", "u_height", "width"],
  );
  crud(
    "dcim/rack-reservations",
    "rack_reservation",
    "rack_reservations",
    "reserved units within a rack",
    rackReservationFilters,
    rackReservationCreate,
    rackReservationUpdate,
    ["rack", "units", "user", "tenant", "description"],
  );
}
