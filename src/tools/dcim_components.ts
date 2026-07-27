/**
 * DCIM device internals & components (Wave 2): module types, modules, module
 * bays, device bays, inventory items + roles, console ports, console server
 * ports, front/rear ports, MAC addresses, and all remaining component
 * templates (console/console-server/interface/front/rear/module-bay/device-bay/
 * inventory-item templates).
 *
 * Components that attach to a device expose `device_id` (not `device`) for the
 * remote-devices bridge; the server maps it back to the API field `device`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerCreate, registerGet, registerList, registerUpdate } from "../registrars.js";
import { CustomFieldsSchema, TagSlugsSchema } from "../schemas/common.js";

const SLUG = /^[-a-zA-Z0-9_]+$/;
const WEIGHT_UNITS = ["kg", "g", "lb", "oz"] as const;
const MODULE_STATUS = ["offline", "active", "planned", "staged", "failed", "decommissioning"] as const;
const CONSOLE_TYPE = "Console port type slug, e.g. 'rj-45', 'usb-a', 'usb-c', 'de-9', 'db-25'.";
const PORT_TYPE = "Port type slug, e.g. '8p8c', 'lc', 'lc-pc', 'sc', 'st', 'mpo', 'fc', 'splice'.";
const IFACE_TYPE = "Interface type slug, e.g. '1000base-t', '10gbase-x-sfpp', '25gbase-x-sfp28', '100gbase-x-qsfp28', 'virtual', 'lag'.";
const DEVICE_ID = z.number().int().describe("Device id (required). Exposed as device_id (not device) for the remote-devices bridge; mapped to the API field device on write.");

/* ---- module types ---- */
const moduleTypeCreate = {
  manufacturer: z.number().int().describe("Manufacturer id (required)."),
  model: z.string().min(1).max(100).describe("Model name (required)."),
  part_number: z.string().max(50).optional(),
  weight: z.number().optional(), weight_unit: z.enum(WEIGHT_UNITS).optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const moduleTypeUpdate = {
  manufacturer: z.number().int().optional(), model: z.string().min(1).max(100).optional(),
  part_number: z.string().max(50).optional(),
  weight: z.number().nullable().optional(), weight_unit: z.enum(WEIGHT_UNITS).nullable().optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

/* ---- modules (installed) ---- */
const moduleCreate = {
  module_bay: z.number().int().describe("Module bay id this module installs into (required)."),
  module_type: z.number().int().describe("Module type id (required)."),
  status: z.enum(MODULE_STATUS).default("active"),
  serial: z.string().max(50).optional(), asset_tag: z.string().max(50).optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const moduleUpdate = {
  module_bay: z.number().int().optional(), module_type: z.number().int().optional(),
  status: z.enum(MODULE_STATUS).optional(),
  serial: z.string().max(50).optional(), asset_tag: z.string().max(50).nullable().optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

/* ---- module bays ---- */
const moduleBayCreate = {
  device_id: DEVICE_ID, name: z.string().min(1).max(64).describe("Module bay name (required)."),
  label: z.string().max(64).optional(), position: z.string().max(30).optional().describe("Position identifier."),
  description: z.string().max(200).optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const moduleBayUpdate = {
  name: z.string().min(1).max(64).optional(), label: z.string().max(64).optional(),
  position: z.string().max(30).optional(), description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

/* ---- device bays ---- */
const deviceBayCreate = {
  device_id: DEVICE_ID, name: z.string().min(1).max(64).describe("Device bay name (required)."),
  label: z.string().max(64).optional(),
  installed_device: z.number().int().optional().describe("Child device id installed in this bay."),
  description: z.string().max(200).optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const deviceBayUpdate = {
  name: z.string().min(1).max(64).optional(), label: z.string().max(64).optional(),
  installed_device: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

/* ---- inventory item roles ---- */
const invItemRoleCreate = {
  name: z.string().min(1).max(100).describe("Name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL slug (required)."),
  color: z.string().optional(), description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const invItemRoleUpdate = {
  name: z.string().min(1).max(100).optional(), slug: z.string().min(1).max(100).regex(SLUG).optional(),
  color: z.string().optional(), description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

/* ---- inventory items ---- */
const invItemCreate = {
  device_id: DEVICE_ID, name: z.string().min(1).max(64).describe("Inventory item name (required)."),
  label: z.string().max(64).optional(),
  role: z.number().int().optional().describe("Inventory item role id."),
  manufacturer: z.number().int().optional().describe("Manufacturer id."),
  parent: z.number().int().optional().describe("Parent inventory item id (nestable)."),
  part_id: z.string().max(50).optional(), serial: z.string().max(50).optional(),
  asset_tag: z.string().max(50).optional(), discovered: z.boolean().optional(),
  component_type: z.string().optional().describe("Optional linked component type, e.g. 'dcim.interface'."),
  component_id: z.number().int().optional().describe("Optional linked component id."),
  description: z.string().max(200).optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const invItemUpdate = {
  name: z.string().min(1).max(64).optional(), label: z.string().max(64).optional(),
  role: z.number().int().nullable().optional(), manufacturer: z.number().int().nullable().optional(),
  parent: z.number().int().nullable().optional(), part_id: z.string().max(50).optional(),
  serial: z.string().max(50).optional(), asset_tag: z.string().max(50).nullable().optional(),
  discovered: z.boolean().optional(),
  component_type: z.string().nullable().optional(), component_id: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(), tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

/* ---- console ports / console server ports ---- */
const consolePortCreate = {
  device_id: DEVICE_ID, name: z.string().min(1).max(64).describe("Port name (required)."),
  label: z.string().max(64).optional(), type: z.string().optional().describe(CONSOLE_TYPE),
  speed: z.number().int().optional().describe("Speed in bps."),
  mark_connected: z.boolean().optional(), description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const consolePortUpdate = {
  name: z.string().min(1).max(64).optional(), label: z.string().max(64).optional(),
  type: z.string().nullable().optional(), speed: z.number().int().nullable().optional(),
  mark_connected: z.boolean().optional(), description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

/* ---- rear ports ---- */
const rearPortCreate = {
  device_id: DEVICE_ID, name: z.string().min(1).max(64).describe("Rear port name (required)."),
  type: z.string().describe(PORT_TYPE + " (required)."),
  label: z.string().max(64).optional(), color: z.string().optional().describe("Hex color without '#'."),
  positions: z.number().int().min(1).max(1024).optional().describe("Number of front ports mappable (default 1)."),
  mark_connected: z.boolean().optional(), description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const rearPortUpdate = {
  name: z.string().min(1).max(64).optional(), type: z.string().optional(),
  label: z.string().max(64).optional(), color: z.string().optional(),
  positions: z.number().int().min(1).max(1024).optional(),
  mark_connected: z.boolean().optional(), description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

/* ---- front ports ---- */
const frontPortCreate = {
  device_id: DEVICE_ID, name: z.string().min(1).max(64).describe("Front port name (required)."),
  type: z.string().describe(PORT_TYPE + " (required)."),
  rear_port: z.number().int().describe("Rear port id this front port maps to (required)."),
  rear_port_position: z.number().int().min(1).optional().describe("Position on the rear port (default 1)."),
  label: z.string().max(64).optional(), color: z.string().optional(),
  mark_connected: z.boolean().optional(), description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const frontPortUpdate = {
  name: z.string().min(1).max(64).optional(), type: z.string().optional(),
  rear_port: z.number().int().optional(), rear_port_position: z.number().int().min(1).optional(),
  label: z.string().max(64).optional(), color: z.string().optional(),
  mark_connected: z.boolean().optional(), description: z.string().max(200).optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

/* ---- MAC addresses ---- */
const macCreate = {
  mac_address: z.string().describe("MAC address, e.g. '00:11:22:33:44:55' (required)."),
  assigned_object_type: z.enum(["dcim.interface", "virtualization.vminterface"]).optional().describe("Set with assigned_object_id to attach to an interface."),
  assigned_object_id: z.number().int().optional().describe("Interface / VM-interface id."),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};
const macUpdate = {
  mac_address: z.string().optional(),
  assigned_object_type: z.enum(["dcim.interface", "virtualization.vminterface"]).nullable().optional(),
  assigned_object_id: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(), comments: z.string().optional(),
  tags: TagSlugsSchema, custom_fields: CustomFieldsSchema,
};

/* ---- component templates (device_type or module_type) ---- */
const tmplParent = {
  device_type: z.number().int().optional().describe("Device type id (set this OR module_type)."),
  module_type: z.number().int().optional().describe("Module type id (set this OR device_type)."),
};
const consoleTmplCreate = { ...tmplParent, name: z.string().min(1).max(64).describe("Name (required)."), label: z.string().max(64).optional(), type: z.string().optional().describe(CONSOLE_TYPE), description: z.string().max(200).optional() };
const consoleTmplUpdate = { device_type: z.number().int().optional(), module_type: z.number().int().optional(), name: z.string().min(1).max(64).optional(), label: z.string().max(64).optional(), type: z.string().nullable().optional(), description: z.string().max(200).optional() };

const ifaceTmplCreate = { ...tmplParent, name: z.string().min(1).max(64).describe("Name (required)."), type: z.string().describe(IFACE_TYPE + " (required)."), enabled: z.boolean().optional(), mgmt_only: z.boolean().optional(), label: z.string().max(64).optional(), description: z.string().max(200).optional(), bridge: z.number().int().optional(), poe_mode: z.enum(["pd", "pse"]).optional(), poe_type: z.string().optional() };
const ifaceTmplUpdate = { device_type: z.number().int().optional(), module_type: z.number().int().optional(), name: z.string().min(1).max(64).optional(), type: z.string().optional(), enabled: z.boolean().optional(), mgmt_only: z.boolean().optional(), label: z.string().max(64).optional(), description: z.string().max(200).optional(), bridge: z.number().int().nullable().optional(), poe_mode: z.enum(["pd", "pse"]).nullable().optional(), poe_type: z.string().nullable().optional() };

const rearTmplCreate = { ...tmplParent, name: z.string().min(1).max(64).describe("Name (required)."), type: z.string().describe(PORT_TYPE + " (required)."), color: z.string().optional(), positions: z.number().int().min(1).max(1024).optional(), label: z.string().max(64).optional(), description: z.string().max(200).optional() };
const rearTmplUpdate = { device_type: z.number().int().optional(), module_type: z.number().int().optional(), name: z.string().min(1).max(64).optional(), type: z.string().optional(), color: z.string().optional(), positions: z.number().int().min(1).max(1024).optional(), label: z.string().max(64).optional(), description: z.string().max(200).optional() };

const frontTmplCreate = { ...tmplParent, name: z.string().min(1).max(64).describe("Name (required)."), type: z.string().describe(PORT_TYPE + " (required)."), rear_port: z.number().int().describe("Rear port TEMPLATE id (required)."), rear_port_position: z.number().int().min(1).optional(), color: z.string().optional(), label: z.string().max(64).optional(), description: z.string().max(200).optional() };
const frontTmplUpdate = { device_type: z.number().int().optional(), module_type: z.number().int().optional(), name: z.string().min(1).max(64).optional(), type: z.string().optional(), rear_port: z.number().int().optional(), rear_port_position: z.number().int().min(1).optional(), color: z.string().optional(), label: z.string().max(64).optional(), description: z.string().max(200).optional() };

const moduleBayTmplCreate = { device_type: z.number().int().describe("Device type id (required)."), name: z.string().min(1).max(64).describe("Name (required)."), label: z.string().max(64).optional(), position: z.string().max(30).optional(), description: z.string().max(200).optional() };
const moduleBayTmplUpdate = { device_type: z.number().int().optional(), name: z.string().min(1).max(64).optional(), label: z.string().max(64).optional(), position: z.string().max(30).optional(), description: z.string().max(200).optional() };

const deviceBayTmplCreate = { device_type: z.number().int().describe("Device type id (required)."), name: z.string().min(1).max(64).describe("Name (required)."), label: z.string().max(64).optional(), description: z.string().max(200).optional() };
const deviceBayTmplUpdate = { device_type: z.number().int().optional(), name: z.string().min(1).max(64).optional(), label: z.string().max(64).optional(), description: z.string().max(200).optional() };

const invItemTmplCreate = { device_type: z.number().int().describe("Device type id (required)."), name: z.string().min(1).max(64).describe("Name (required)."), label: z.string().max(64).optional(), role: z.number().int().optional(), manufacturer: z.number().int().optional(), parent: z.number().int().optional(), part_id: z.string().max(50).optional(), component_type: z.string().optional(), component_id: z.number().int().optional(), description: z.string().max(200).optional() };
const invItemTmplUpdate = { device_type: z.number().int().optional(), name: z.string().min(1).max(64).optional(), label: z.string().max(64).optional(), role: z.number().int().nullable().optional(), manufacturer: z.number().int().nullable().optional(), parent: z.number().int().nullable().optional(), part_id: z.string().max(50).optional(), component_type: z.string().nullable().optional(), component_id: z.number().int().nullable().optional(), description: z.string().max(200).optional() };

export function registerDcimComponents(server: McpServer): void {
  const crud = (endpoint: string, singular: string, plural: string, description: string, filters: any, create: any, update: any, listFields?: string[]) => {
    registerList(server, { endpoint, singular, plural, description, listFields }, filters);
    registerGet(server, { endpoint, singular, plural, description });
    registerCreate(server, { endpoint, singular, plural, description }, create);
    registerUpdate(server, { endpoint, singular, plural, description }, update);
  };
  const dev = { device_id: z.number().int().optional(), device: z.string().optional(), name: z.string().optional(), name__ic: z.string().optional() };
  const dt = { device_type_id: z.number().int().optional(), name: z.string().optional(), name__ic: z.string().optional() };

  crud("dcim/module-types", "module_type", "module_types", "module models (line cards, etc.)", { manufacturer_id: z.number().int().optional(), model: z.string().optional() }, moduleTypeCreate, moduleTypeUpdate, ["model", "manufacturer", "part_number"]);
  crud("dcim/modules", "module", "modules", "installed modules", { device_id: z.number().int().optional(), module_bay_id: z.number().int().optional(), status: z.string().optional() }, moduleCreate, moduleUpdate, ["module_type", "module_bay", "status", "serial"]);
  crud("dcim/module-bays", "module_bay", "module_bays", "bays that hold modules", dev, moduleBayCreate, moduleBayUpdate, ["name", "device", "position"]);
  crud("dcim/device-bays", "device_bay", "device_bays", "bays that hold child devices", dev, deviceBayCreate, deviceBayUpdate, ["name", "device", "installed_device"]);
  crud("dcim/inventory-item-roles", "inventory_item_role", "inventory_item_roles", "inventory item roles", { name: z.string().optional(), slug: z.string().optional() }, invItemRoleCreate, invItemRoleUpdate, ["name", "slug", "color"]);
  crud("dcim/inventory-items", "inventory_item", "inventory_items", "discrete inventory items on a device", { ...dev, role_id: z.number().int().optional(), manufacturer_id: z.number().int().optional(), serial: z.string().optional() }, invItemCreate, invItemUpdate, ["name", "device", "role", "manufacturer", "serial"]);
  crud("dcim/console-ports", "console_port", "console_ports", "device console ports", { ...dev, type: z.string().optional() }, consolePortCreate, consolePortUpdate, ["name", "device", "type", "description"]);
  crud("dcim/console-server-ports", "console_server_port", "console_server_ports", "device console server ports", { ...dev, type: z.string().optional() }, consolePortCreate, consolePortUpdate, ["name", "device", "type", "description"]);
  crud("dcim/rear-ports", "rear_port", "rear_ports", "patch-panel rear ports", { ...dev, type: z.string().optional() }, rearPortCreate, rearPortUpdate, ["name", "device", "type", "positions"]);
  crud("dcim/front-ports", "front_port", "front_ports", "patch-panel front ports", { ...dev, type: z.string().optional() }, frontPortCreate, frontPortUpdate, ["name", "device", "type", "rear_port"]);
  crud("dcim/mac-addresses", "mac_address", "mac_addresses", "MAC address objects", { mac_address: z.string().optional() }, macCreate, macUpdate, ["mac_address", "assigned_object", "description"]);

  crud("dcim/console-port-templates", "console_port_template", "console_port_templates", "console port templates", dt, consoleTmplCreate, consoleTmplUpdate, ["name", "device_type", "type"]);
  crud("dcim/console-server-port-templates", "console_server_port_template", "console_server_port_templates", "console server port templates", dt, consoleTmplCreate, consoleTmplUpdate, ["name", "device_type", "type"]);
  crud("dcim/interface-templates", "interface_template", "interface_templates", "interface templates", dt, ifaceTmplCreate, ifaceTmplUpdate, ["name", "device_type", "type", "mgmt_only"]);
  crud("dcim/rear-port-templates", "rear_port_template", "rear_port_templates", "rear port templates", dt, rearTmplCreate, rearTmplUpdate, ["name", "device_type", "type", "positions"]);
  crud("dcim/front-port-templates", "front_port_template", "front_port_templates", "front port templates", dt, frontTmplCreate, frontTmplUpdate, ["name", "device_type", "type", "rear_port"]);
  crud("dcim/module-bay-templates", "module_bay_template", "module_bay_templates", "module bay templates", dt, moduleBayTmplCreate, moduleBayTmplUpdate, ["name", "device_type", "position"]);
  crud("dcim/device-bay-templates", "device_bay_template", "device_bay_templates", "device bay templates", dt, deviceBayTmplCreate, deviceBayTmplUpdate, ["name", "device_type"]);
  crud("dcim/inventory-item-templates", "inventory_item_template", "inventory_item_templates", "inventory item templates", dt, invItemTmplCreate, invItemTmplUpdate, ["name", "device_type", "role", "manufacturer"]);
}
