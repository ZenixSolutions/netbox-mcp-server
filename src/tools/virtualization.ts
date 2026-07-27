/** Virtualization tools (Wave 3): cluster types/groups, clusters, VM types, VMs, VM interfaces, virtual disks. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerCreate, registerGet, registerList, registerUpdate } from "../registrars.js";
import { CustomFieldsSchema, TagSlugsSchema } from "../schemas/common.js";

const SLUG = /^[-a-zA-Z0-9_]+$/;
const CLUSTER_STATUS = ["active", "planned", "staging", "decommissioning", "offline"] as const;
const VM_STATUS = ["offline", "active", "planned", "staged", "failed", "decommissioning"] as const;
const CLUSTER_SCOPES = ["dcim.site", "dcim.location", "dcim.region", "dcim.sitegroup"] as const;

const clusterTypeCreate = { name: z.string().min(1).max(100).describe("Name (required)."), slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."), description: z.string().max(200).optional(), comments: z.string().optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema };
const clusterTypeUpdate = { name: z.string().min(1).max(100).optional(), slug: z.string().min(1).max(100).regex(SLUG).optional(), description: z.string().max(200).optional(), comments: z.string().optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema };

const clusterCreate = {
  name: z.string().min(1).max(100).describe("Cluster name (required)."),
  type: z.number().int().describe("Cluster type id (required)."),
  group: z.number().int().optional().describe("Cluster group id."),
  status: z.enum(CLUSTER_STATUS).default("active"),
  scope_type: z.enum(CLUSTER_SCOPES).optional().describe("Scope object type (NetBox 4.2+ replaced 'site' with scope); set with scope_id."),
  scope_id: z.number().int().optional().describe("Numeric id of the scope object."),
  tenant: z.number().int().optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const clusterUpdate = {
  name: z.string().min(1).max(100).optional(), type: z.number().int().optional(),
  group: z.number().int().nullable().optional(), status: z.enum(CLUSTER_STATUS).optional(),
  scope_type: z.enum(CLUSTER_SCOPES).nullable().optional(), scope_id: z.number().int().nullable().optional(),
  tenant: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const vmTypeCreate = { name: z.string().min(1).max(100).describe("Name (required)."), slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."), default_platform: z.number().int().optional(), default_vcpus: z.number().optional(), default_memory: z.number().int().optional().describe("Default memory (MB)."), description: z.string().max(200).optional(), comments: z.string().optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema };
const vmTypeUpdate = { name: z.string().min(1).max(100).optional(), slug: z.string().min(1).max(100).regex(SLUG).optional(), default_platform: z.number().int().nullable().optional(), default_vcpus: z.number().nullable().optional(), default_memory: z.number().int().nullable().optional(), description: z.string().max(200).optional(), comments: z.string().optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema };

const vmCreate = {
  name: z.string().min(1).max(64).describe("VM name (required)."),
  status: z.enum(VM_STATUS).default("active"),
  cluster: z.number().int().optional().describe("Cluster id (VM needs a cluster or a device)."),
  device_id: z.number().int().optional().describe("Host device id (alternative to cluster). Exposed as device_id (not device) for the bridge; mapped to the API field device on write."),
  site: z.number().int().optional().describe("Site id."),
  role: z.number().int().optional().describe("Device role id."),
  virtual_machine_type: z.number().int().optional().describe("VM type id."),
  platform: z.number().int().optional(), tenant: z.number().int().optional(),
  vcpus: z.number().optional(), memory: z.number().int().optional().describe("Memory (MB)."),
  disk: z.number().int().optional().describe("Disk (MB)."),
  primary_ip4: z.number().int().optional(), primary_ip6: z.number().int().optional(),
  serial: z.string().max(50).optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  config_template: z.number().int().optional(),
  local_context_data: z.record(z.string(), z.unknown()).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const vmUpdate = {
  name: z.string().min(1).max(64).optional(), status: z.enum(VM_STATUS).optional(),
  cluster: z.number().int().nullable().optional(), device_id: z.number().int().nullable().optional(),
  site: z.number().int().nullable().optional(), role: z.number().int().nullable().optional(),
  virtual_machine_type: z.number().int().nullable().optional(),
  platform: z.number().int().nullable().optional(), tenant: z.number().int().nullable().optional(),
  vcpus: z.number().nullable().optional(), memory: z.number().int().nullable().optional(),
  disk: z.number().int().nullable().optional(),
  primary_ip4: z.number().int().nullable().optional(), primary_ip6: z.number().int().nullable().optional(),
  serial: z.string().max(50).optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  config_template: z.number().int().nullable().optional(),
  local_context_data: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const vmIfaceCreate = {
  virtual_machine: z.number().int().describe("Virtual machine id (required)."),
  name: z.string().min(1).max(64).describe("Interface name (required)."),
  enabled: z.boolean().default(true), parent: z.number().int().optional(), bridge: z.number().int().optional(),
  mtu: z.number().int().min(1).max(65536).optional(),
  mode: z.enum(["access", "tagged", "tagged-all"]).optional(),
  untagged_vlan: z.number().int().optional(), tagged_vlans: z.array(z.number().int()).optional(),
  vrf: z.number().int().optional(), description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const vmIfaceUpdate = {
  name: z.string().min(1).max(64).optional(), enabled: z.boolean().optional(),
  parent: z.number().int().nullable().optional(), bridge: z.number().int().nullable().optional(),
  mtu: z.number().int().min(1).max(65536).nullable().optional(),
  mode: z.enum(["access", "tagged", "tagged-all"]).nullable().optional(),
  untagged_vlan: z.number().int().nullable().optional(), tagged_vlans: z.array(z.number().int()).optional(),
  vrf: z.number().int().nullable().optional(), description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

const vdiskCreate = { virtual_machine: z.number().int().describe("Virtual machine id (required)."), name: z.string().min(1).max(64).describe("Disk name (required)."), size: z.number().int().describe("Size in MB (required)."), description: z.string().max(200).optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema };
const vdiskUpdate = { name: z.string().min(1).max(64).optional(), size: z.number().int().optional(), description: z.string().max(200).optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema };

export function registerVirtualization(server: McpServer): void {
  const crud = (endpoint: string, singular: string, plural: string, description: string, filters: any, create: any, update: any, listFields?: string[]) => {
    registerList(server, { endpoint, singular, plural, description, listFields }, filters);
    registerGet(server, { endpoint, singular, plural, description });
    registerCreate(server, { endpoint, singular, plural, description }, create);
    registerUpdate(server, { endpoint, singular, plural, description }, update);
  };
  const nameSlug = { name: z.string().optional(), slug: z.string().optional() };
  crud("virtualization/cluster-types", "cluster_type", "cluster_types", "cluster types (technology)", nameSlug, clusterTypeCreate, clusterTypeUpdate, ["name", "slug", "description"]);
  crud("virtualization/cluster-groups", "cluster_group", "cluster_groups", "cluster groups", nameSlug, clusterTypeCreate, clusterTypeUpdate, ["name", "slug", "description"]);
  crud("virtualization/clusters", "cluster", "clusters", "compute clusters", { name: z.string().optional(), type_id: z.number().int().optional(), group_id: z.number().int().optional(), status: z.string().optional() }, clusterCreate, clusterUpdate, ["name", "type", "group", "status"]);
  crud("virtualization/virtual-machine-types", "virtual_machine_type", "virtual_machine_types", "virtual machine types", nameSlug, vmTypeCreate, vmTypeUpdate, ["name", "slug", "description"]);
  crud("virtualization/virtual-machines", "virtual_machine", "virtual_machines", "virtual machines", { name: z.string().optional(), cluster_id: z.number().int().optional(), status: z.string().optional(), role_id: z.number().int().optional(), tenant_id: z.number().int().optional() }, vmCreate, vmUpdate, ["name", "status", "cluster", "role", "vcpus", "memory"]);
  crud("virtualization/interfaces", "vm_interface", "vm_interfaces", "virtual machine interfaces", { virtual_machine_id: z.number().int().optional(), name: z.string().optional() }, vmIfaceCreate, vmIfaceUpdate, ["name", "virtual_machine", "enabled", "mtu"]);
  crud("virtualization/virtual-disks", "virtual_disk", "virtual_disks", "virtual machine disks", { virtual_machine_id: z.number().int().optional(), name: z.string().optional() }, vdiskCreate, vdiskUpdate, ["name", "virtual_machine", "size"]);
}
