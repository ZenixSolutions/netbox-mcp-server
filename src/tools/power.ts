/**
 * DCIM power modeling tool registrations.
 *
 * Covers NetBox's power model:
 *   Power Panel (site) -> Power Feed (rack) --cable--> Power Port (PDU inlet)
 *     -> Power Outlets (PDU) --cable--> Power Port (device PSU)
 * plus the device-type-level templates (power port / power outlet templates)
 * that let a device type define its inlets/outlets once and have every device
 * built from it inherit them (mirrors interface templates).
 *
 * Device-level power ports and outlets expose the owning device as `device_id`
 * (not `device`) because the remote-devices bridge reserves the bare name
 * `device`; the server maps device_id back to the API field `device` on write.
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

const FEED_STATUS = ["offline", "active", "planned", "failed"] as const;
const FEED_TYPE = ["primary", "redundant"] as const;
const FEED_SUPPLY = ["ac", "dc"] as const;
const FEED_PHASE = ["single-phase", "three-phase"] as const;
const FEED_LEG = ["A", "B", "C"] as const;
const POWER_TYPE_HINT =
  "Power connector type slug, e.g. 'iec-60320-c14', 'iec-60320-c20', 'iec-60320-c13', 'iec-60320-c19', 'nema-5-15p', 'nema-l6-20p', 'nema-5-15r'.";

/* ================= power panels ================= */

const powerPanelFilters = {
  name: z.string().optional().describe("Exact panel name."),
  site_id: z.number().int().optional().describe("Filter by site id."),
  location_id: z.number().int().optional().describe("Filter by location id."),
};
const powerPanelCreate = {
  name: z.string().min(1).max(100).describe("Panel name (required)."),
  site: z.number().int().describe("Site id (required)."),
  location: z.number().int().optional().describe("Location id within the site."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const powerPanelUpdate = {
  name: z.string().min(1).max(100).optional(),
  site: z.number().int().optional(),
  location: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ================= power feeds ================= */

const powerFeedFilters = {
  name: z.string().optional().describe("Exact feed name."),
  power_panel_id: z.number().int().optional().describe("Filter by power panel id."),
  rack_id: z.number().int().optional().describe("Filter by rack id."),
  site_id: z.number().int().optional().describe("Filter by site id."),
  status: z.enum(FEED_STATUS).optional(),
  type: z.enum(FEED_TYPE).optional(),
  supply: z.enum(FEED_SUPPLY).optional(),
  phase: z.enum(FEED_PHASE).optional(),
  tenant_id: z.number().int().optional().describe("Filter by tenant id."),
};
const powerFeedCreate = {
  power_panel: z.number().int().describe("Power panel id (required)."),
  name: z.string().min(1).max(100).describe("Feed name (required)."),
  rack: z.number().int().optional().describe("Rack id this feed serves."),
  status: z.enum(FEED_STATUS).default("active"),
  type: z.enum(FEED_TYPE).default("primary").describe("'primary' or 'redundant' (A-side / B-side)."),
  supply: z.enum(FEED_SUPPLY).default("ac"),
  phase: z.enum(FEED_PHASE).default("single-phase"),
  voltage: z.number().int().optional().describe("Voltage (V)."),
  amperage: z.number().int().optional().describe("Amperage (A)."),
  max_utilization: z.number().int().min(1).max(100).optional().describe("Max utilization percent (NetBox default 80)."),
  mark_connected: z.boolean().optional().describe("Treat as connected even without a cable."),
  tenant: z.number().int().optional().describe("Tenant id."),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const powerFeedUpdate = {
  power_panel: z.number().int().optional(),
  name: z.string().min(1).max(100).optional(),
  rack: z.number().int().nullable().optional(),
  status: z.enum(FEED_STATUS).optional(),
  type: z.enum(FEED_TYPE).optional(),
  supply: z.enum(FEED_SUPPLY).optional(),
  phase: z.enum(FEED_PHASE).optional(),
  voltage: z.number().int().nullable().optional(),
  amperage: z.number().int().nullable().optional(),
  max_utilization: z.number().int().min(1).max(100).optional(),
  mark_connected: z.boolean().optional(),
  tenant: z.number().int().nullable().optional(),
  description: z.string().max(200).optional(),
  comments: z.string().optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ================= power ports (device-level) ================= */

const powerPortFilters = {
  device_id: z.number().int().optional().describe("Numeric device id."),
  device: z.string().optional().describe("Device name."),
  name: z.string().optional().describe("Exact port name."),
  name__ic: z.string().optional().describe("Port name contains (case-insensitive)."),
  type: z.string().optional().describe("Power port type slug."),
  connected: z.boolean().optional().describe("Only connected (true) or unconnected (false) ports."),
};
const powerPortCreate = {
  device_id: z.number().int().describe("Device id (required). Exposed as device_id (not device) for the remote-devices bridge; mapped to the API field device on write."),
  name: z.string().min(1).max(64).describe("Power port name (required), e.g. 'PSU1'."),
  label: z.string().max(64).optional(),
  type: z.string().optional().describe(POWER_TYPE_HINT),
  maximum_draw: z.number().int().min(1).optional().describe("Maximum draw in watts."),
  allocated_draw: z.number().int().min(1).optional().describe("Allocated draw in watts."),
  mark_connected: z.boolean().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const powerPortUpdate = {
  name: z.string().min(1).max(64).optional(),
  label: z.string().max(64).optional(),
  type: z.string().nullable().optional(),
  maximum_draw: z.number().int().min(1).nullable().optional(),
  allocated_draw: z.number().int().min(1).nullable().optional(),
  mark_connected: z.boolean().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ================= power outlets (device-level) ================= */

const powerOutletFilters = {
  device_id: z.number().int().optional().describe("Numeric device id."),
  device: z.string().optional().describe("Device name."),
  name: z.string().optional().describe("Exact outlet name."),
  name__ic: z.string().optional().describe("Outlet name contains (case-insensitive)."),
  type: z.string().optional().describe("Power outlet type slug."),
  power_port_id: z.number().int().optional().describe("Filter by parent power port id."),
  feed_leg: z.enum(FEED_LEG).optional().describe("Phase leg: A, B, or C."),
};
const powerOutletCreate = {
  device_id: z.number().int().describe("Device id (required). Exposed as device_id (not device) for the remote-devices bridge; mapped to the API field device on write."),
  name: z.string().min(1).max(64).describe("Outlet name (required), e.g. 'Outlet 1'."),
  label: z.string().max(64).optional(),
  type: z.string().optional().describe(POWER_TYPE_HINT),
  power_port: z.number().int().optional().describe("Parent power port id (the inlet on this same PDU that feeds this outlet)."),
  feed_leg: z.enum(FEED_LEG).optional().describe("Phase leg this outlet is on: A, B, or C."),
  mark_connected: z.boolean().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};
const powerOutletUpdate = {
  name: z.string().min(1).max(64).optional(),
  label: z.string().max(64).optional(),
  type: z.string().nullable().optional(),
  power_port: z.number().int().nullable().optional(),
  feed_leg: z.enum(FEED_LEG).nullable().optional(),
  mark_connected: z.boolean().optional(),
  description: z.string().max(200).optional(),
  tags: TagSlugsSchema,
  custom_fields: CustomFieldsSchema,
};

/* ================= power port templates (device-type-level) ================= */

const powerPortTemplateFilters = {
  device_type_id: z.number().int().optional().describe("Filter by device type id."),
  name: z.string().optional().describe("Exact template name."),
  name__ic: z.string().optional().describe("Template name contains (case-insensitive)."),
};
const powerPortTemplateCreate = {
  device_type: z.number().int().describe("Device type id (required)."),
  name: z.string().min(1).max(64).describe("Power port template name (required)."),
  label: z.string().max(64).optional(),
  type: z.string().optional().describe(POWER_TYPE_HINT),
  maximum_draw: z.number().int().min(1).optional().describe("Maximum draw in watts."),
  allocated_draw: z.number().int().min(1).optional().describe("Allocated draw in watts."),
  description: z.string().max(200).optional(),
};
const powerPortTemplateUpdate = {
  device_type: z.number().int().optional(),
  name: z.string().min(1).max(64).optional(),
  label: z.string().max(64).optional(),
  type: z.string().nullable().optional(),
  maximum_draw: z.number().int().min(1).nullable().optional(),
  allocated_draw: z.number().int().min(1).nullable().optional(),
  description: z.string().max(200).optional(),
};

/* ================= power outlet templates (device-type-level) ================= */

const powerOutletTemplateFilters = {
  device_type_id: z.number().int().optional().describe("Filter by device type id."),
  name: z.string().optional().describe("Exact template name."),
  name__ic: z.string().optional().describe("Template name contains (case-insensitive)."),
};
const powerOutletTemplateCreate = {
  device_type: z.number().int().describe("Device type id (required)."),
  name: z.string().min(1).max(64).describe("Power outlet template name (required)."),
  label: z.string().max(64).optional(),
  type: z.string().optional().describe(POWER_TYPE_HINT),
  power_port: z.number().int().optional().describe("Parent power port TEMPLATE id on the same device type."),
  feed_leg: z.enum(FEED_LEG).optional().describe("Phase leg: A, B, or C."),
  description: z.string().max(200).optional(),
};
const powerOutletTemplateUpdate = {
  device_type: z.number().int().optional(),
  name: z.string().min(1).max(64).optional(),
  label: z.string().max(64).optional(),
  type: z.string().nullable().optional(),
  power_port: z.number().int().nullable().optional(),
  feed_leg: z.enum(FEED_LEG).nullable().optional(),
  description: z.string().max(200).optional(),
};

/* ================= wire everything up ================= */

export function registerPower(server: McpServer): void {
  // power panels
  registerList(server, {
    endpoint: "dcim/power-panels",
    singular: "power_panel",
    plural: "power_panels",
    description: "power distribution panels at a site",
    listFields: ["name", "site", "location", "description"],
  }, powerPanelFilters);
  registerGet(server, {
    endpoint: "dcim/power-panels",
    singular: "power_panel",
    plural: "power_panels",
    description: "power distribution panels",
  });
  registerCreate(server, {
    endpoint: "dcim/power-panels",
    singular: "power_panel",
    plural: "power_panels",
    description: "power distribution panels",
  }, powerPanelCreate);
  registerUpdate(server, {
    endpoint: "dcim/power-panels",
    singular: "power_panel",
    plural: "power_panels",
    description: "power distribution panels",
  }, powerPanelUpdate);

  // power feeds
  registerList(server, {
    endpoint: "dcim/power-feeds",
    singular: "power_feed",
    plural: "power_feeds",
    description: "power feeds (a circuit from a panel to a rack)",
    listFields: ["name", "power_panel", "rack", "status", "type", "supply", "phase", "voltage", "amperage", "available_power"],
  }, powerFeedFilters);
  registerGet(server, {
    endpoint: "dcim/power-feeds",
    singular: "power_feed",
    plural: "power_feeds",
    description: "power feeds",
  });
  registerCreate(server, {
    endpoint: "dcim/power-feeds",
    singular: "power_feed",
    plural: "power_feeds",
    description: "power feeds",
  }, powerFeedCreate, {
    descriptionExtra: "available_power (watts) is computed by NetBox and read-only; it appears in responses but is not a writable field.",
  });
  registerUpdate(server, {
    endpoint: "dcim/power-feeds",
    singular: "power_feed",
    plural: "power_feeds",
    description: "power feeds",
  }, powerFeedUpdate);

  // power ports (device-level)
  registerList(server, {
    endpoint: "dcim/power-ports",
    singular: "power_port",
    plural: "power_ports",
    description: "device power inlets (PSU inlets)",
    listFields: ["name", "device", "type", "maximum_draw", "allocated_draw", "cable", "description"],
  }, powerPortFilters);
  registerGet(server, {
    endpoint: "dcim/power-ports",
    singular: "power_port",
    plural: "power_ports",
    description: "device power inlets",
  });
  registerCreate(server, {
    endpoint: "dcim/power-ports",
    singular: "power_port",
    plural: "power_ports",
    description: "device power inlets",
  }, powerPortCreate);
  registerUpdate(server, {
    endpoint: "dcim/power-ports",
    singular: "power_port",
    plural: "power_ports",
    description: "device power inlets",
  }, powerPortUpdate);

  // power outlets (device-level)
  registerList(server, {
    endpoint: "dcim/power-outlets",
    singular: "power_outlet",
    plural: "power_outlets",
    description: "PDU power outlets",
    listFields: ["name", "device", "type", "power_port", "feed_leg", "cable", "description"],
  }, powerOutletFilters);
  registerGet(server, {
    endpoint: "dcim/power-outlets",
    singular: "power_outlet",
    plural: "power_outlets",
    description: "PDU power outlets",
  });
  registerCreate(server, {
    endpoint: "dcim/power-outlets",
    singular: "power_outlet",
    plural: "power_outlets",
    description: "PDU power outlets",
  }, powerOutletCreate);
  registerUpdate(server, {
    endpoint: "dcim/power-outlets",
    singular: "power_outlet",
    plural: "power_outlets",
    description: "PDU power outlets",
  }, powerOutletUpdate);

  // power port templates (device-type-level)
  registerList(server, {
    endpoint: "dcim/power-port-templates",
    singular: "power_port_template",
    plural: "power_port_templates",
    description: "power inlets defined on a device type (inherited by its devices)",
    listFields: ["name", "device_type", "type", "maximum_draw", "allocated_draw"],
  }, powerPortTemplateFilters);
  registerGet(server, {
    endpoint: "dcim/power-port-templates",
    singular: "power_port_template",
    plural: "power_port_templates",
    description: "power port templates",
  });
  registerCreate(server, {
    endpoint: "dcim/power-port-templates",
    singular: "power_port_template",
    plural: "power_port_templates",
    description: "power port templates",
  }, powerPortTemplateCreate);
  registerUpdate(server, {
    endpoint: "dcim/power-port-templates",
    singular: "power_port_template",
    plural: "power_port_templates",
    description: "power port templates",
  }, powerPortTemplateUpdate);

  // power outlet templates (device-type-level)
  registerList(server, {
    endpoint: "dcim/power-outlet-templates",
    singular: "power_outlet_template",
    plural: "power_outlet_templates",
    description: "power outlets defined on a device type (inherited by its devices)",
    listFields: ["name", "device_type", "type", "power_port", "feed_leg"],
  }, powerOutletTemplateFilters);
  registerGet(server, {
    endpoint: "dcim/power-outlet-templates",
    singular: "power_outlet_template",
    plural: "power_outlet_templates",
    description: "power outlet templates",
  });
  registerCreate(server, {
    endpoint: "dcim/power-outlet-templates",
    singular: "power_outlet_template",
    plural: "power_outlet_templates",
    description: "power outlet templates",
  }, powerOutletTemplateCreate);
  registerUpdate(server, {
    endpoint: "dcim/power-outlet-templates",
    singular: "power_outlet_template",
    plural: "power_outlet_templates",
    description: "power outlet templates",
  }, powerOutletTemplateUpdate);
}
