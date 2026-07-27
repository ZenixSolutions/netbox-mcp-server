/** IPAM foundation tools: RIRs, ASNs, ASN ranges, route targets. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerCreate, registerGet, registerList, registerUpdate } from "../registrars.js";
import { CustomFieldsSchema, TagSlugsSchema } from "../schemas/common.js";

const SLUG = /^[-a-zA-Z0-9_]+$/;

const rirCreate = {
  name: z.string().min(1).max(100).describe("RIR name (required), e.g. ARIN, RIPE."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  is_private: z.boolean().optional().describe("True for RFC 1918 / private space authorities."),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const rirUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  is_private: z.boolean().optional(), description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const asnCreate = {
  asn: z.number().int().describe("AS number (required)."),
  rir: z.number().int().optional().describe("RIR id."),
  tenant: z.number().int().optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const asnUpdate = {
  asn: z.number().int().optional(),
  rir: z.number().int().nullable().optional(),
  tenant: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const asnRangeCreate = {
  name: z.string().min(1).max(100).describe("ASN range name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  rir: z.number().int().describe("RIR id (required)."),
  start: z.number().int().describe("First ASN in the range (required)."),
  end: z.number().int().describe("Last ASN in the range (required)."),
  tenant: z.number().int().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const asnRangeUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  rir: z.number().int().optional(),
  start: z.number().int().optional(), end: z.number().int().optional(),
  tenant: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const routeTargetCreate = {
  name: z.string().min(1).max(21).describe("Route target, e.g. '65000:100' (required)."),
  tenant: z.number().int().optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const routeTargetUpdate = {
  name: z.string().min(1).max(21).optional(),
  tenant: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

export function registerIpamOrg(server: McpServer): void {
  const crud = (endpoint: string, singular: string, plural: string, description: string, filters: any, create: any, update: any, listFields?: string[]) => {
    registerList(server, { endpoint, singular, plural, description, listFields }, filters);
    registerGet(server, { endpoint, singular, plural, description });
    registerCreate(server, { endpoint, singular, plural, description }, create);
    registerUpdate(server, { endpoint, singular, plural, description }, update);
  };
  crud("ipam/rirs", "rir", "rirs", "Regional Internet Registries", { name: z.string().optional(), slug: z.string().optional() }, rirCreate, rirUpdate, ["name", "slug", "is_private", "description"]);
  crud("ipam/asns", "asn", "asns", "Autonomous System Numbers", { asn: z.number().int().optional(), rir_id: z.number().int().optional(), tenant_id: z.number().int().optional() }, asnCreate, asnUpdate, ["asn", "rir", "tenant", "description"]);
  crud("ipam/asn-ranges", "asn_range", "asn_ranges", "ranges of ASNs", { name: z.string().optional(), rir_id: z.number().int().optional() }, asnRangeCreate, asnRangeUpdate, ["name", "slug", "rir", "start", "end"]);
  crud("ipam/route-targets", "route_target", "route_targets", "BGP route targets for VRFs", { name: z.string().optional(), tenant_id: z.number().int().optional() }, routeTargetCreate, routeTargetUpdate, ["name", "tenant", "description"]);
}
