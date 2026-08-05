# Workflows

Playbooks for the common jobs. Each names the lookups to do, the questions
genuinely worth asking, the build order, and what to confirm. Every one of them
assumes the loop in SKILL.md: resolve, describe, plan, confirm, write, verify.

Shorthand used below:

- **discover** = `netbox_discover`
- **describe X for op** = `netbox_describe {object_type: X, operation: op}`
- **read** = `netbox_read`, **write** = `netbox_write`

## Cabling two endpoints

The most common request: "connect X to Y", "patch this into that".

1. **Resolve both endpoints.** `netbox_global_search` on each device name to get
   its id, then read `dcim.interface` with
   `filters: {device_id: <id>, name: "<port>"}` for each side. For a patch-panel
   port use `dcim.frontport` / `dcim.rearport`; for console or power, the
   matching component type. Capture each port's numeric id.
2. **Check occupancy.** Each port's `cable` field is non-null if it is already
   connected. If so, stop and tell the user — the existing cable must be deleted
   first, which is its own confirmed delete.
3. **Describe `dcim.cable` for `create`** once.
4. **Ask only what is missing:** cable `type`, and optionally `length` +
   `length_unit`, `label`, `color`, `status`. Infer `type` from the ports where
   you can: a 1000base-t port is copper (`cat6`), a short SFP+ link is usually
   `dac-passive`, a long or QSFP link is fiber.
5. **Plan and confirm:** "Cable dc1-leaf-01 `Eth1/19` (dcim.interface id 79) to
   dc1-fw-01 `xe-0/0/3` (id 85), type `mmf-om4`, status connected."
6. **Write:**

   ```json
   {
     "object_type": "dcim.cable",
     "operation": "create",
     "data": {
       "a_terminations": [{ "object_type": "dcim.interface", "object_id": 79 }],
       "b_terminations": [{ "object_type": "dcim.interface", "object_id": 85 }],
       "type": "mmf-om4",
       "status": "connected"
     }
   }
   ```

7. **Verify:** read the cable back; both ports now show it.

## Adding a device (racking and NICs)

"Add the new Dell R640 in rack 12", "stand up this switch".

1. **Resolve prerequisites** — all independent, so do them together:
   `dcim.devicetype` (filter by `model` or `slug`, plus `manufacturer_id`),
   `dcim.devicerole`, `dcim.site`, and `dcim.rack` + `dcim.location` if racking.
   If the device type does not exist, do the hardware playbook first.
2. **Ask only what you cannot resolve:** device `name`; `status` (default
   `active`); if racking, `position` (the lowest U) and `face`; `serial` and
   `asset_tag` if known; `platform` / `tenant` if the environment uses them.
3. **Describe `dcim.device` for `create`** and, if you are adding NICs,
   `dcim.interface` for `create`. Two describes for the whole task.
4. **Interfaces:** ask how many and their names/types unless the user already
   said. If the device type has interface templates, NetBox creates the ports
   automatically on device creation — read the device's interfaces after
   creating it and add only what is missing.
5. **Plan and confirm** the device plus every interface, with resolved ids.
6. **Write in order:** device → capture `id` → each interface with
   `device: <that id>`. Create a LAG interface before its members, then set each
   member's `lag`.
7. **Verify:** get the device; check placement and the interface list.

## Modeling new hardware (a device type)

1. **Resolve or create the manufacturer** — read `dcim.manufacturer` filtered by
   `slug`; create with `name` + `slug` if absent.
2. **Ask:** `model`, `u_height` (0 for zero-U PDUs and shelves),
   `is_full_depth`, `part_number`; `subdevice_role` for a modular chassis.
3. **Plan, confirm, create `dcim.devicetype`.**
4. **Offer component templates.** `dcim.interfacetemplate`,
   `dcim.powerporttemplate`, `dcim.consoleporttemplate` and friends make every
   future device of this model inherit its ports. Worth doing for a model the
   user will deploy repeatedly; it is a separate batch of creates, so ask first.

## Adding NICs to an existing device

1. **Resolve the device** → id, then read its existing interfaces
   (`dcim.interface`, `filters: {device_id: <id>}`) so you do not duplicate a
   name.
2. **Ask:** names, `type`, and any of `enabled`, `mtu`, `mgmt_only`,
   `mode` + VLANs, `lag`.
3. **Describe `dcim.interface` for `create` once**, plan, confirm, then create
   each. LAG parent before members.

## Allocating an IP (and making it primary)

1. **Resolve the interface** (device → interface id). Sanity-check the subnet by
   reading `ipam.prefix` with `filters: {contains: "10.20.30.5"}` — that
   confirms the mask and the VRF you should be using.
2. **Ask or derive:** the `address` **with the host subnet mask** (not `/32`
   unless it is a true loopback or host route), `status`, `dns_name`, `vrf` if
   not global, and whether it should become the device's primary IP.
3. **Plan and confirm.**
4. **Create `ipam.ipaddress`** with `address`,
   `assigned_object_type: "dcim.interface"`, `assigned_object_id: <iface id>`.
   Capture the new id.
5. **If primary:** `update` `dcim.device` id with
   `data: {"primary_ip4": <ip id>}`.
6. **Verify.**

## Creating a VLAN (with its prefix)

1. **Resolve** the `ipam.vlangroup` and/or `dcim.site`, and the `ipam.role` if
   the environment uses roles.
2. **Ask:** `vid`, `name`, `status`, and whether a prefix should be created for
   it.
3. **Plan and confirm.**
4. **Create the VLAN** → capture id → create `ipam.prefix` with
   `vlan: <vlan id>`, the CIDR, and `scope_type`/`scope_id` if it attaches to a
   site.

## Carving a prefix

1. **Resolve context:** read `ipam.prefix` with
   `filters: {contains: "<cidr>"}` to find the containing supernet, plus the
   `vrf`, `role`, and the scope target (site or location id) if attaching one.
2. **Ask:** the CIDR, `status` (a supernet you will subdivide is `container`;
   leaf subnets are `active`), `role`, `is_pool`.
3. **Plan, confirm, create.** Scope is `scope_type` + `scope_id`, never `site`.

## Site / rack intake (green field)

Build top-down, creating each tier only if it is missing:

1. `dcim.site` — name, slug, status, region/tenant if any.
2. `dcim.location` — name, slug, site, parent if nested.
3. `dcim.rack` — name, site, location, `u_height`, `width`, `form_factor`,
   role, status.

Confirm the whole tree in one plan, then create top-down, feeding each id
forward. One describe per tier.

## Asset intake (netbox-inventory)

1. **Confirm the plugin exists:** `netbox_discover {app: "plugins/inventory"}`.
2. **Resolve or choose the hardware type** — exactly one of `device_type`,
   `module_type`, `inventoryitem_type`, `rack_type`. Small parts (SFPs, cables)
   are usually an inventory item type; resolve or create
   `plugins.inventory.inventoryitemtype` first.
3. **Optionally resolve** supplier, purchase, delivery, storage location, owning
   tenant, asset role.
4. **Ask:** `serial` and/or `asset_tag`, `status`, and how many.
5. **Plan and confirm** — for several identical items, list every serial.
6. **Create** each asset with its single hardware-type reference plus the shared
   fields.

## Bulk creation

When the user hands you a list — a rack of servers, a VLAN range, a spreadsheet
of assets:

1. Parse the list and resolve the shared references **once** (site, role, device
   type, group). Describe each type **once**.
2. **Present the whole batch as one plan** — a compact table of the N objects
   with their per-row values, plus the shared fields — and confirm before
   writing anything. Do not create half of them and then ask again.
3. Write in dependency order. If a row fails, report which one and why, continue
   with the rest, and summarise succeeded/failed at the end.
4. Check the uniqueness keys before writing: device name within a site, VID
   within a group, prefix within a VRF.

## Deleting something

Deletes cascade in NetBox and cannot be undone. Removing a site can remove its
locations, racks, devices, interfaces, cables and prefixes.

1. **Read the object first:** `netbox_read` with `operation: "get"` and its id.
   Note the `display` value exactly.
2. **Work out the blast radius** and tell the user. Read the dependent
   collections — devices in the rack, prefixes scoped to the site — and say how
   many objects are at risk. Do not present a delete as a small change.
3. **Get explicit confirmation from the user**, naming the object.
4. **Write:** `{object_type, operation: "delete", id, confirm: "<display>"}`.
   `confirm` must match the current `display` exactly; a mismatch is refused and
   shows both values, which means either the id is wrong or the object changed —
   re-read it, do not retry blind.
5. **Prefer a status change** when the user's intent is "retire" rather than
   "erase": `decommissioning` / `deprecated` / `retired` keeps the history.
