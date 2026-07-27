/** IPAM services & redundancy (Wave 5): FHRP groups + assignments, services, service templates, VLAN translation. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerCreate, registerGet, registerList, registerUpdate } from "../registrars.js";
import { CustomFieldsSchema, TagSlugsSchema } from "../schemas/common.js";

const FHRP_PROTO = ["vrrp2", "vrrp3", "carp", "clusterxl", "hsrp", "glbp", "other"] as const;
const L4_PROTO = ["tcp", "udp", "sctp"] as const;
const PORTS = z.array(z.number().int().min(1).max(65535));

const fhrpCreate = {
  protocol: z.enum(FHRP_PROTO).describe("FHRP protocol (required)."),
  group_id: z.number().int().describe("Protocol group id / VRID (required)."),
  name: z.string().max(100).optional(),
  auth_type: z.enum(["plaintext", "md5"]).optional(),
  auth_key: z.string().max(255).optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const fhrpUpdate = {
  protocol: z.enum(FHRP_PROTO).optional(), group_id: z.number().int().optional(),
  name: z.string().max(100).optional(), auth_type: z.enum(["plaintext", "md5"]).nullable().optional(),
  auth_key: z.string().max(255).optional(), description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const fhrpAsgnCreate = {
  group: z.number().int().describe("FHRP group id (required)."),
  interface_type: z.enum(["dcim.interface", "virtualization.vminterface"]).describe("Interface object type (required)."),
  interface_id: z.number().int().describe("Interface / VM-interface id (required)."),
  priority: z.number().int().min(0).max(255).describe("Priority 0-255 (required)."),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const fhrpAsgnUpdate = {
  group: z.number().int().optional(),
  interface_type: z.enum(["dcim.interface", "virtualization.vminterface"]).optional(),
  interface_id: z.number().int().optional(), priority: z.number().int().min(0).max(255).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const serviceCreate = {
  parent_object_type: z.enum(["dcim.device", "virtualization.virtualmachine", "ipam.fhrpgroup"]).describe("Parent object type (required). NetBox 4.3+ uses a generic parent, not device/virtual_machine."),
  parent_object_id: z.number().int().describe("Parent object id (required)."),
  name: z.string().min(1).max(100).describe("Service name (required)."),
  protocol: z.enum(L4_PROTO).describe("L4 protocol (required)."),
  ports: PORTS.describe("Array of port numbers, e.g. [80, 443] (required)."),
  ipaddresses: z.array(z.number().int()).optional().describe("IP address ids this service is bound to."),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const serviceUpdate = {
  parent_object_type: z.enum(["dcim.device", "virtualization.virtualmachine", "ipam.fhrpgroup"]).optional(),
  parent_object_id: z.number().int().optional(),
  name: z.string().min(1).max(100).optional(), protocol: z.enum(L4_PROTO).optional(),
  ports: PORTS.optional(), ipaddresses: z.array(z.number().int()).optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const svcTmplCreate = { name: z.string().min(1).max(100).describe("Template name (required)."), protocol: z.enum(L4_PROTO).describe("L4 protocol (required)."), ports: PORTS.describe("Array of ports (required)."), description: z.string().max(200).optional(), comments: z.string().optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema };
const svcTmplUpdate = { name: z.string().min(1).max(100).optional(), protocol: z.enum(L4_PROTO).optional(), ports: PORTS.optional(), description: z.string().max(200).optional(), comments: z.string().optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema };

const vlanXPolicyCreate = { name: z.string().min(1).max(100).describe("Policy name (required)."), description: z.string().max(200).optional(), comments: z.string().optional() };
const vlanXPolicyUpdate = { name: z.string().min(1).max(100).optional(), description: z.string().max(200).optional(), comments: z.string().optional() };

const vlanXRuleCreate = { policy: z.number().int().describe("VLAN translation policy id (required)."), local_vid: z.number().int().min(1).max(4094).describe("Local VID (required)."), remote_vid: z.number().int().min(1).max(4094).describe("Remote VID (required)."), description: z.string().max(200).optional() };
const vlanXRuleUpdate = { policy: z.number().int().optional(), local_vid: z.number().int().min(1).max(4094).optional(), remote_vid: z.number().int().min(1).max(4094).optional(), description: z.string().max(200).optional() };

export function registerIpamServices(server: McpServer): void {
  const crud = (endpoint: string, singular: string, plural: string, description: string, filters: any, create: any, update: any, listFields?: string[]) => {
    registerList(server, { endpoint, singular, plural, description, listFields }, filters);
    registerGet(server, { endpoint, singular, plural, description });
    registerCreate(server, { endpoint, singular, plural, description }, create);
    registerUpdate(server, { endpoint, singular, plural, description }, update);
  };
  crud("ipam/fhrp-groups", "fhrp_group", "fhrp_groups", "First Hop Redundancy Protocol groups (VRRP/HSRP/etc.)", { protocol: z.string().optional(), group_id: z.number().int().optional() }, fhrpCreate, fhrpUpdate, ["protocol", "group_id", "name", "auth_type"]);
  crud("ipam/fhrp-group-assignments", "fhrp_group_assignment", "fhrp_group_assignments", "FHRP group to interface assignments", { group_id: z.number().int().optional() }, fhrpAsgnCreate, fhrpAsgnUpdate, ["group", "interface_type", "priority"]);
  crud("ipam/services", "service", "services", "L4 services on devices/VMs", { name: z.string().optional(), protocol: z.string().optional() }, serviceCreate, serviceUpdate, ["name", "protocol", "ports", "parent"]);
  crud("ipam/service-templates", "service_template", "service_templates", "reusable service templates", { name: z.string().optional(), protocol: z.string().optional() }, svcTmplCreate, svcTmplUpdate, ["name", "protocol", "ports"]);
  crud("ipam/vlan-translation-policies", "vlan_translation_policy", "vlan_translation_policies", "VLAN translation policies", { name: z.string().optional() }, vlanXPolicyCreate, vlanXPolicyUpdate, ["name", "description"]);
  crud("ipam/vlan-translation-rules", "vlan_translation_rule", "vlan_translation_rules", "VLAN translation rules", { policy_id: z.number().int().optional() }, vlanXRuleCreate, vlanXRuleUpdate, ["policy", "local_vid", "remote_vid"]);
}
