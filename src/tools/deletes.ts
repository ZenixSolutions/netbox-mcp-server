/**
 * Delete tools for every managed resource, registered centrally.
 *
 * Deletes are destructive and NetBox cascades them — see registerDelete for the
 * warning wired into each tool's description. Every object the server can
 * create is listed here so it also gets a `netbox_delete_<singular>` tool.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDelete } from "../registrars.js";

// [endpoint, singular]
const RESOURCES: [string, string][] = [
  // DCIM core
  ["dcim/sites", "site"],
  ["dcim/locations", "location"],
  ["dcim/racks", "rack"],
  ["dcim/manufacturers", "manufacturer"],
  ["dcim/device-types", "device_type"],
  ["dcim/device-roles", "device_role"],
  ["dcim/platforms", "platform"],
  ["dcim/devices", "device"],
  ["dcim/interfaces", "interface"],
  ["dcim/cables", "cable"],
  // DCIM power
  ["dcim/power-panels", "power_panel"],
  ["dcim/power-feeds", "power_feed"],
  ["dcim/power-ports", "power_port"],
  ["dcim/power-outlets", "power_outlet"],
  ["dcim/power-port-templates", "power_port_template"],
  ["dcim/power-outlet-templates", "power_outlet_template"],
  // DCIM org
  ["dcim/regions", "region"],
  ["dcim/site-groups", "site_group"],
  ["dcim/rack-roles", "rack_role"],
  ["dcim/rack-types", "rack_type"],
  ["dcim/rack-reservations", "rack_reservation"],
  // DCIM components + templates
  ["dcim/module-types", "module_type"],
  ["dcim/modules", "module"],
  ["dcim/module-bays", "module_bay"],
  ["dcim/device-bays", "device_bay"],
  ["dcim/inventory-item-roles", "inventory_item_role"],
  ["dcim/inventory-items", "inventory_item"],
  ["dcim/console-ports", "console_port"],
  ["dcim/console-server-ports", "console_server_port"],
  ["dcim/rear-ports", "rear_port"],
  ["dcim/front-ports", "front_port"],
  ["dcim/mac-addresses", "mac_address"],
  ["dcim/console-port-templates", "console_port_template"],
  ["dcim/console-server-port-templates", "console_server_port_template"],
  ["dcim/interface-templates", "interface_template"],
  ["dcim/rear-port-templates", "rear_port_template"],
  ["dcim/front-port-templates", "front_port_template"],
  ["dcim/module-bay-templates", "module_bay_template"],
  ["dcim/device-bay-templates", "device_bay_template"],
  ["dcim/inventory-item-templates", "inventory_item_template"],
  // IPAM core
  ["ipam/prefixes", "prefix"],
  ["ipam/ip-addresses", "ip_address"],
  ["ipam/vlans", "vlan"],
  ["ipam/vlan-groups", "vlan_group"],
  ["ipam/vrfs", "vrf"],
  ["ipam/aggregates", "aggregate"],
  ["ipam/ip-ranges", "ip_range"],
  ["ipam/roles", "role"],
  // IPAM foundation
  ["ipam/rirs", "rir"],
  ["ipam/asns", "asn"],
  ["ipam/asn-ranges", "asn_range"],
  ["ipam/route-targets", "route_target"],
  // IPAM services
  ["ipam/fhrp-groups", "fhrp_group"],
  ["ipam/fhrp-group-assignments", "fhrp_group_assignment"],
  ["ipam/services", "service"],
  ["ipam/service-templates", "service_template"],
  ["ipam/vlan-translation-policies", "vlan_translation_policy"],
  ["ipam/vlan-translation-rules", "vlan_translation_rule"],
  // Tenancy
  ["tenancy/tenant-groups", "tenant_group"],
  ["tenancy/tenants", "tenant"],
  ["tenancy/contact-groups", "contact_group"],
  ["tenancy/contact-roles", "contact_role"],
  ["tenancy/contacts", "contact"],
  ["tenancy/contact-assignments", "contact_assignment"],
  // Virtualization
  ["virtualization/cluster-types", "cluster_type"],
  ["virtualization/cluster-groups", "cluster_group"],
  ["virtualization/clusters", "cluster"],
  ["virtualization/virtual-machine-types", "virtual_machine_type"],
  ["virtualization/virtual-machines", "virtual_machine"],
  ["virtualization/interfaces", "vm_interface"],
  ["virtualization/virtual-disks", "virtual_disk"],
  // Circuits
  ["circuits/providers", "provider"],
  ["circuits/provider-accounts", "provider_account"],
  ["circuits/provider-networks", "provider_network"],
  ["circuits/circuit-types", "circuit_type"],
  ["circuits/circuits", "circuit"],
  ["circuits/circuit-terminations", "circuit_termination"],
  ["circuits/circuit-groups", "circuit_group"],
  ["circuits/circuit-group-assignments", "circuit_group_assignment"],
  ["circuits/virtual-circuits", "virtual_circuit"],
  ["circuits/virtual-circuit-types", "virtual_circuit_type"],
  ["circuits/virtual-circuit-terminations", "virtual_circuit_termination"],
  // netbox-inventory plugin
  ["plugins/inventory/assets", "asset"],
  ["plugins/inventory/suppliers", "supplier"],
  ["plugins/inventory/purchases", "purchase"],
  ["plugins/inventory/deliveries", "delivery"],
  ["plugins/inventory/asset-roles", "asset_role"],
  ["plugins/inventory/inventory-item-types", "inventory_item_type"],
  ["plugins/inventory/inventory-item-groups", "inventory_item_group"],
];

export function registerDeletes(server: McpServer): void {
  for (const [endpoint, singular] of RESOURCES) {
    registerDelete(server, { endpoint, singular });
  }
}
