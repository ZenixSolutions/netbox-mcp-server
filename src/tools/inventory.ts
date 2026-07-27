/**
 * netbox-inventory plugin tool registrations.
 *
 * Covers the ArnesSI "netbox-inventory" plugin (shown as "Inventory" in the
 * NetBox UI). All endpoints live under /api/plugins/inventory/.
 *
 * Read (list + get) and write (create + update, PATCH semantics) for every
 * model: assets, suppliers, purchases, deliveries, asset roles, inventory
 * item types, and inventory item groups.
 *
 * Tested against netbox-inventory v2.6.0.
 *
 * Note: NetBox's generic object-ownership field ("owner") is intentionally not
 * exposed on writes. The meaningful asset-owner field, "owning_tenant", is.
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

/* ================= assets ================= */

const assetFilters = {
  name: z.string().optional().describe("Exact asset name."),
  name__ic: z.string().optional().describe("Asset name contains (case-insensitive)."),
  serial: z.string().optional().describe("Exact serial number."),
  asset_tag: z.string().optional().describe("Exact asset tag."),
  status: z
    .string()
    .optional()
    .describe(
      "Asset lifecycle status. Defaults in netbox-inventory are 'stored', 'used', 'retired' (your instance may define custom statuses).",
    ),
  kind: z
    .string()
    .optional()
    .describe("Hardware kind: 'device', 'module', 'inventoryitem', or 'rack'."),
  manufacturer_id: z.number().int().optional().describe("Filter by manufacturer id."),
  tenant_id: z.number().int().optional().describe("Filter by using-tenant id."),
  owning_tenant_id: z.number().int().optional().describe("Filter by owning-tenant (owner) id."),
  role_id: z.number().int().optional().describe("Filter by asset role id."),
  supplier_id: z.number().int().optional().describe("Filter by supplier id."),
  purchase_id: z.number().int().optional().describe("Filter by purchase id."),
  delivery_id: z.number().int().optional().describe("Filter by delivery id."),
  storage_location_id: z
    .number()
    .int()
    .optional()
    .describe("Filter by storage location (dcim location) id."),
  inventoryitem_group_id: z
    .number()
    .int()
    .optional()
    .describe("Filter by inventory item group id."),
  inventoryitem_type_id: z
    .number()
    .int()
    .optional()
    .describe("Filter by inventory item type id."),
  device_id: z.number().int().optional().describe("Asset assigned to this device id."),
  module_id: z.number().int().optional().describe("Asset assigned to this module id."),
  rack_id: z.number().int().optional().describe("Asset assigned to this rack id."),
};

const assetCreate = {
  status: z
    .string()
    .describe(
      "Asset lifecycle status (required). netbox-inventory defaults: 'stored', 'used', 'retired' (or your instance's custom statuses).",
    ),
  name: z.string().max(128).optional().describe("Asset name (optional; often derived from hardware)."),
  asset_tag: z.string().max(50).optional().describe("Identifier assigned by owner."),
  serial: z.string().max(60).optional().describe("Identifier assigned by manufacturer."),
  description: z.string().optional(),
  role: z.number().int().optional().describe("Asset role id."),
  // Hardware type — set exactly ONE of these:
  device_type: z
    .number()
    .int()
    .optional()
    .describe("dcim device-type id. Set exactly ONE hardware type (device_type / module_type / inventoryitem_type / rack_type)."),
  module_type: z.number().int().optional().describe("dcim module-type id."),
  inventoryitem_type: z.number().int().optional().describe("inventory item type id."),
  rack_type: z.number().int().optional().describe("dcim rack-type id."),
  // Assignment (optional; must match the hardware type):
  device_id: z.number().int().optional().describe("Assign to dcim device id. Exposed as device_id (not device) for the remote-devices bridge; mapped back to the NetBox API field device on write."),
  module: z.number().int().optional().describe("Assign to dcim module id."),
  inventoryitem: z.number().int().optional().describe("Assign to dcim inventory-item id."),
  rack: z.number().int().optional().describe("Assign to dcim rack id."),
  // Related parties:
  tenant: z.number().int().optional().describe("Using-tenant id."),
  contact: z.number().int().optional().describe("Contact id."),
  owning_tenant: z.number().int().optional().describe("Owning-tenant id (asset owner)."),
  storage_location: z.number().int().optional().describe("dcim location id where the asset is stored."),
  purchase: z.number().int().optional().describe("Purchase id."),
  delivery: z.number().int().optional().describe("Delivery id."),
  warranty_start: z.string().optional().describe("Warranty start date (ISO-8601, YYYY-MM-DD)."),
  warranty_end: z.string().optional().describe("Warranty end date (ISO-8601, YYYY-MM-DD)."),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const assetUpdate = {
  status: z.string().optional(),
  name: z.string().max(128).optional(),
  asset_tag: z.string().max(50).nullable().optional(),
  serial: z.string().max(60).nullable().optional(),
  description: z.string().optional(),
  role: z.number().int().nullable().optional(),
  device_type: z.number().int().nullable().optional(),
  module_type: z.number().int().nullable().optional(),
  inventoryitem_type: z.number().int().nullable().optional(),
  rack_type: z.number().int().nullable().optional(),
  device_id: z.number().int().nullable().optional().describe("Assign to dcim device id (mapped to the NetBox API field device)."),
  module: z.number().int().nullable().optional(),
  inventoryitem: z.number().int().nullable().optional(),
  rack: z.number().int().nullable().optional(),
  tenant: z.number().int().nullable().optional(),
  contact: z.number().int().nullable().optional(),
  owning_tenant: z.number().int().nullable().optional(),
  storage_location: z.number().int().nullable().optional(),
  purchase: z.number().int().nullable().optional(),
  delivery: z.number().int().nullable().optional(),
  warranty_start: z.string().nullable().optional(),
  warranty_end: z.string().nullable().optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ================= suppliers ================= */

const supplierFilters = {
  name: z.string().optional().describe("Exact supplier name."),
  slug: z.string().optional().describe("Exact supplier slug."),
};

const supplierCreate = {
  name: z.string().min(1).max(100).describe("Supplier name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL-safe slug (required, unique)."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const supplierUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ================= purchases ================= */

const purchaseFilters = {
  name: z.string().optional().describe("Exact purchase name."),
  status: z
    .string()
    .optional()
    .describe("Purchase status: 'open', 'partial', or 'closed'."),
  supplier_id: z.number().int().optional().describe("Filter by supplier id."),
  date: z.string().optional().describe("Purchase date (ISO-8601, YYYY-MM-DD)."),
};

const purchaseCreate = {
  name: z.string().min(1).max(100).describe("Purchase name (required)."),
  supplier: z.number().int().describe("Supplier id (required)."),
  status: z
    .enum(["open", "partial", "closed"])
    .describe("Purchase status (required)."),
  date: z.string().optional().describe("Purchase date (ISO-8601, YYYY-MM-DD)."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const purchaseUpdate = {
  name: z.string().min(1).max(100).optional(),
  supplier: z.number().int().optional(),
  status: z.enum(["open", "partial", "closed"]).optional(),
  date: z.string().nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ================= deliveries ================= */

const deliveryFilters = {
  name: z.string().optional().describe("Exact delivery name."),
  purchase_id: z.number().int().optional().describe("Filter by purchase id."),
  supplier_id: z.number().int().optional().describe("Filter by supplier id."),
  date: z.string().optional().describe("Delivery date (ISO-8601, YYYY-MM-DD)."),
};

const deliveryCreate = {
  name: z.string().min(1).max(100).describe("Delivery name (required)."),
  purchase: z.number().int().describe("Purchase id (required)."),
  date: z.string().optional().describe("Delivery date (ISO-8601, YYYY-MM-DD)."),
  receiving_contact: z.number().int().optional().describe("Receiving contact id."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const deliveryUpdate = {
  name: z.string().min(1).max(100).optional(),
  purchase: z.number().int().optional(),
  date: z.string().nullable().optional(),
  receiving_contact: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ================= asset roles ================= */

const assetRoleFilters = {
  name: z.string().optional().describe("Exact role name."),
  slug: z.string().optional().describe("Exact role slug."),
};

const assetRoleCreate = {
  name: z.string().min(1).max(100).describe("Role name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL-safe slug (required, unique)."),
  color: z.string().optional().describe("Hex color without '#', e.g. '9e9e9e'."),
  description: z.string().max(200).optional(),
  parent: z.number().int().optional().describe("Parent asset role id (roles are nested)."),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const assetRoleUpdate = {
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  color: z.string().optional(),
  description: z.string().max(200).optional(),
  parent: z.number().int().nullable().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ================= inventory item types ================= */

const inventoryItemTypeFilters = {
  model: z.string().optional().describe("Exact model name."),
  slug: z.string().optional().describe("Exact slug."),
  part_number: z.string().optional().describe("Manufacturer part number."),
  manufacturer_id: z.number().int().optional().describe("Filter by manufacturer id."),
  inventoryitem_group_id: z
    .number()
    .int()
    .optional()
    .describe("Filter by inventory item group id."),
};

const inventoryItemTypeCreate = {
  manufacturer: z.number().int().describe("Manufacturer id (required)."),
  model: z.string().min(1).max(100).describe("Model name (required)."),
  slug: z.string().min(1).max(100).regex(SLUG).describe("URL-safe slug (required, unique per manufacturer)."),
  part_number: z.string().max(50).optional().describe("Manufacturer part number."),
  inventoryitem_group: z.number().int().optional().describe("Inventory item group id."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const inventoryItemTypeUpdate = {
  manufacturer: z.number().int().optional(),
  model: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).regex(SLUG).optional(),
  part_number: z.string().max(50).nullable().optional(),
  inventoryitem_group: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ================= inventory item groups ================= */

const inventoryItemGroupFilters = {
  name: z.string().optional().describe("Exact group name."),
  parent_id: z.number().int().optional().describe("Parent group id (for nested groups)."),
};

const inventoryItemGroupCreate = {
  name: z.string().min(1).max(100).describe("Group name (required)."),
  parent: z.number().int().optional().describe("Parent group id (groups are nested)."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

const inventoryItemGroupUpdate = {
  name: z.string().min(1).max(100).optional(),
  parent: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ================= wire everything up ================= */

export function registerInventory(server: McpServer): void {
  // assets
  registerList(server, {
    endpoint: "plugins/inventory/assets",
    singular: "asset",
    plural: "assets",
    description: "hardware inventory assets (netbox-inventory plugin)",
    listFields: [
      "name",
      "serial",
      "asset_tag",
      "status",
      "kind",
      "manufacturer",
      "device",
      "module",
      "inventoryitem",
      "rack",
      "storage_location",
      "tenant",
      "owning_tenant",
      "purchase",
      "delivery",
    ],
  }, assetFilters);
  registerGet(server, {
    endpoint: "plugins/inventory/assets",
    singular: "asset",
    plural: "assets",
    description: "hardware inventory assets",
  });
  registerCreate(server, {
    endpoint: "plugins/inventory/assets",
    singular: "asset",
    plural: "assets",
    description: "hardware inventory assets",
  }, assetCreate, {
    descriptionExtra:
      "Every asset needs exactly ONE hardware type set: device_type, module_type, inventoryitem_type, or rack_type.",
  });
  registerUpdate(server, {
    endpoint: "plugins/inventory/assets",
    singular: "asset",
    plural: "assets",
    description: "hardware inventory assets",
  }, assetUpdate);

  // suppliers
  registerList(server, {
    endpoint: "plugins/inventory/suppliers",
    singular: "supplier",
    plural: "suppliers",
    description: "asset suppliers / vendors (netbox-inventory plugin)",
    listFields: ["name", "slug", "description"],
  }, supplierFilters);
  registerGet(server, {
    endpoint: "plugins/inventory/suppliers",
    singular: "supplier",
    plural: "suppliers",
    description: "asset suppliers / vendors",
  });
  registerCreate(server, {
    endpoint: "plugins/inventory/suppliers",
    singular: "supplier",
    plural: "suppliers",
    description: "asset suppliers / vendors",
  }, supplierCreate);
  registerUpdate(server, {
    endpoint: "plugins/inventory/suppliers",
    singular: "supplier",
    plural: "suppliers",
    description: "asset suppliers / vendors",
  }, supplierUpdate);

  // purchases
  registerList(server, {
    endpoint: "plugins/inventory/purchases",
    singular: "purchase",
    plural: "purchases",
    description: "purchases of assets from a supplier (netbox-inventory plugin)",
    listFields: ["name", "supplier", "status", "date", "description"],
  }, purchaseFilters);
  registerGet(server, {
    endpoint: "plugins/inventory/purchases",
    singular: "purchase",
    plural: "purchases",
    description: "purchases of assets from a supplier",
  });
  registerCreate(server, {
    endpoint: "plugins/inventory/purchases",
    singular: "purchase",
    plural: "purchases",
    description: "purchases of assets from a supplier",
  }, purchaseCreate);
  registerUpdate(server, {
    endpoint: "plugins/inventory/purchases",
    singular: "purchase",
    plural: "purchases",
    description: "purchases of assets from a supplier",
  }, purchaseUpdate);

  // deliveries
  registerList(server, {
    endpoint: "plugins/inventory/deliveries",
    singular: "delivery",
    plural: "deliveries",
    description: "deliveries of purchased assets (netbox-inventory plugin)",
    listFields: ["name", "purchase", "date", "receiving_contact", "description"],
  }, deliveryFilters);
  registerGet(server, {
    endpoint: "plugins/inventory/deliveries",
    singular: "delivery",
    plural: "deliveries",
    description: "deliveries of purchased assets",
  });
  registerCreate(server, {
    endpoint: "plugins/inventory/deliveries",
    singular: "delivery",
    plural: "deliveries",
    description: "deliveries of purchased assets",
  }, deliveryCreate);
  registerUpdate(server, {
    endpoint: "plugins/inventory/deliveries",
    singular: "delivery",
    plural: "deliveries",
    description: "deliveries of purchased assets",
  }, deliveryUpdate);

  // asset roles
  registerList(server, {
    endpoint: "plugins/inventory/asset-roles",
    singular: "asset_role",
    plural: "asset_roles",
    description: "asset roles (netbox-inventory plugin)",
    listFields: ["name", "slug", "color", "description"],
  }, assetRoleFilters);
  registerGet(server, {
    endpoint: "plugins/inventory/asset-roles",
    singular: "asset_role",
    plural: "asset_roles",
    description: "asset roles",
  });
  registerCreate(server, {
    endpoint: "plugins/inventory/asset-roles",
    singular: "asset_role",
    plural: "asset_roles",
    description: "asset roles",
  }, assetRoleCreate);
  registerUpdate(server, {
    endpoint: "plugins/inventory/asset-roles",
    singular: "asset_role",
    plural: "asset_roles",
    description: "asset roles",
  }, assetRoleUpdate);

  // inventory item types
  registerList(server, {
    endpoint: "plugins/inventory/inventory-item-types",
    singular: "inventory_item_type",
    plural: "inventory_item_types",
    description: "inventory item types / catalog models (netbox-inventory plugin)",
    listFields: ["model", "slug", "manufacturer", "part_number", "inventoryitem_group"],
  }, inventoryItemTypeFilters);
  registerGet(server, {
    endpoint: "plugins/inventory/inventory-item-types",
    singular: "inventory_item_type",
    plural: "inventory_item_types",
    description: "inventory item types / catalog models",
  });
  registerCreate(server, {
    endpoint: "plugins/inventory/inventory-item-types",
    singular: "inventory_item_type",
    plural: "inventory_item_types",
    description: "inventory item types / catalog models",
  }, inventoryItemTypeCreate);
  registerUpdate(server, {
    endpoint: "plugins/inventory/inventory-item-types",
    singular: "inventory_item_type",
    plural: "inventory_item_types",
    description: "inventory item types / catalog models",
  }, inventoryItemTypeUpdate);

  // inventory item groups
  registerList(server, {
    endpoint: "plugins/inventory/inventory-item-groups",
    singular: "inventory_item_group",
    plural: "inventory_item_groups",
    description: "inventory item groups (netbox-inventory plugin)",
    listFields: ["name", "parent", "description"],
  }, inventoryItemGroupFilters);
  registerGet(server, {
    endpoint: "plugins/inventory/inventory-item-groups",
    singular: "inventory_item_group",
    plural: "inventory_item_groups",
    description: "inventory item groups",
  });
  registerCreate(server, {
    endpoint: "plugins/inventory/inventory-item-groups",
    singular: "inventory_item_group",
    plural: "inventory_item_groups",
    description: "inventory item groups",
  }, inventoryItemGroupCreate);
  registerUpdate(server, {
    endpoint: "plugins/inventory/inventory-item-groups",
    singular: "inventory_item_group",
    plural: "inventory_item_groups",
    description: "inventory item groups",
  }, inventoryItemGroupUpdate);
}
