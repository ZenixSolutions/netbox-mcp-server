/** Tenancy tools: tenant groups, tenants, contact groups, contact roles, contacts, contact assignments. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerCreate, registerGet, registerList, registerUpdate } from "../registrars.js";
import { CustomFieldsSchema, TagSlugsSchema } from "../schemas/common.js";

const SLUG = /^[-a-zA-Z0-9_]+$/;

const nestedGroupCreate = {
  name: z.string().min(1).max(100).describe("Name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  parent: z.number().int().optional().describe("Parent id (nestable)."),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const nestedGroupUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  parent: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const tenantCreate = {
  name: z.string().min(1).max(100).describe("Tenant name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  group: z.number().int().optional().describe("Tenant group id."),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const tenantUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  group: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const contactRoleCreate = {
  name: z.string().min(1).max(100).describe("Contact role name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const contactRoleUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const contactCreate = {
  name: z.string().min(1).max(100).describe("Contact name (required)."),
  group: z.number().int().optional().describe("Contact group id."),
  title: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().max(254).optional(),
  address: z.string().optional(),
  link: z.string().optional().describe("URL."),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const contactUpdate = {
  name: z.string().min(1).max(100).optional(),
  group: z.number().int().nullable().optional(),
  title: z.string().max(100).optional(), phone: z.string().max(50).optional(),
  email: z.string().max(254).optional(), address: z.string().optional(),
  link: z.string().optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const contactAssignmentCreate = {
  object_type: z.string().describe("Assigned object type, e.g. 'dcim.device', 'dcim.site', 'circuits.circuit' (required)."),
  object_id: z.number().int().describe("Numeric id of the object the contact is assigned to (required)."),
  contact: z.number().int().describe("Contact id (required)."),
  role: z.number().int().optional().describe("Contact role id."),
  priority: z.enum(["primary", "secondary", "tertiary", "inactive"]).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const contactAssignmentUpdate = {
  object_type: z.string().optional(),
  object_id: z.number().int().optional(),
  contact: z.number().int().optional(),
  role: z.number().int().nullable().optional(),
  priority: z.enum(["primary", "secondary", "tertiary", "inactive"]).nullable().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

export function registerTenancy(server: McpServer): void {
  const crud = (endpoint: string, singular: string, plural: string, description: string, filters: any, create: any, update: any, listFields?: string[]) => {
    registerList(server, { endpoint, singular, plural, description, listFields }, filters);
    registerGet(server, { endpoint, singular, plural, description });
    registerCreate(server, { endpoint, singular, plural, description }, create);
    registerUpdate(server, { endpoint, singular, plural, description }, update);
  };
  const nameSlug = { name: z.string().optional(), slug: z.string().optional() };
  crud("tenancy/tenant-groups", "tenant_group", "tenant_groups", "tenant groups (nestable)", { ...nameSlug, parent_id: z.number().int().optional() }, nestedGroupCreate, nestedGroupUpdate, ["name", "slug", "parent", "description"]);
  crud("tenancy/tenants", "tenant", "tenants", "tenants (customers/departments)", { ...nameSlug, group_id: z.number().int().optional() }, tenantCreate, tenantUpdate, ["name", "slug", "group", "description"]);
  crud("tenancy/contact-groups", "contact_group", "contact_groups", "contact groups (nestable)", { ...nameSlug, parent_id: z.number().int().optional() }, nestedGroupCreate, nestedGroupUpdate, ["name", "slug", "parent", "description"]);
  crud("tenancy/contact-roles", "contact_role", "contact_roles", "contact roles", nameSlug, contactRoleCreate, contactRoleUpdate, ["name", "slug", "description"]);
  crud("tenancy/contacts", "contact", "contacts", "contacts (people/teams)", { name: z.string().optional(), group_id: z.number().int().optional(), email: z.string().optional() }, contactCreate, contactUpdate, ["name", "title", "phone", "email", "group"]);
  crud("tenancy/contact-assignments", "contact_assignment", "contact_assignments", "assignments of contacts to objects", { contact_id: z.number().int().optional(), role_id: z.number().int().optional() }, contactAssignmentCreate, contactAssignmentUpdate, ["contact", "role", "priority", "object_type"]);
}
