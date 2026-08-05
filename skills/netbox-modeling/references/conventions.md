# Conventions and defaults

Defaults to _recommend_, not to force. Always show what you are proposing in the
plan so the user can override. The goal is a clean, consistent, queryable source
of truth — a tidy uniform model beats a sparse exhaustive one.

Where a field is an enum, `netbox_describe` gives the exact accepted values for
the connected instance. The values quoted here are the stock NetBox 4.x sets and
are a good default when you are proposing something, not a substitute for
describing the type.

## Naming and slugs

- **Slugs** derive from the name: lowercase, spaces and dots to hyphens, drop
  other punctuation. `Dell R640` → `dell-r640`; `Data Room B: Row 4` →
  `data-room-b-row-4`. Slugs must be unique within their type and are stable
  identifiers — get them right the first time.
- **Devices:** consistent, predictable hostnames. If NetBox already shows a
  convention, match it; otherwise propose `<site>-<role>-<nn>` (e.g.
  `lindon-leaf-01`) and zero-pad the number.
- **Interfaces:** use the real hardware names — `GigabitEthernet1/0/1`,
  `Eth1/19`, `xe-0/0/0`, `mgmt0` — never invented ones. They have to match the
  device for cabling and monitoring to line up.
- **Search before creating.** A second "Rack 12" or a duplicated prefix is
  painful to untangle later, and NetBox will not stop you.

## Statuses and lifecycle

- New in-service gear: `active`. Pre-deployment: `planned` or `staged`. Being
  removed: `decommissioning`. Kept for parts or history: `inventory` (device) or
  `retired` (asset).
- Prefixes: a supernet you will subdivide is `container`; assigned subnets are
  `active`; space held back is `reserved`.
- Prefer a status change to a delete when the user means "retire".

## Device roles and colors

- Give each role a distinct `color` (6 hex digits, no `#`) so rack elevations
  and lists are readable. Common: switches green, routers blue, firewalls red,
  servers grey, storage teal, PDUs amber, patch panels neutral. Consistency
  matters more than the exact hue.
- Set `vm_role: true` only for roles that virtual machines also use.

## Device vs module vs inventory item vs asset

- **Device** — anything that mounts and has its own network identity and ports:
  switch, router, server, firewall, PDU. Zero-U things like PDUs are still
  devices, with `u_height: 0` on the device type.
- **Module** — a field-replaceable card in a module bay (line card,
  supervisor).
- **Inventory item** — a non-networked sub-component recorded on a device: an
  SFP in a port, a fan, a PSU. Descriptive, not a full device.
- **Asset** (netbox-inventory) — the _physical unit_ tracked for procurement and
  lifecycle (in stock, RMA, spare, owned by a tenant), independent of whether it
  is installed. Use assets for stock and spares; use a device/module/inventory
  item for what is actually racked and cabled. An asset can point at the
  installed object.

## Interface types (cheat sheet)

Match the physical port. `netbox_describe dcim.interface create` lists all ~200
values; these are the ones you will actually propose:

- **Copper:** `1000base-t`, `2.5gbase-t`, `5gbase-t`, `10gbase-t`.
- **SFP / SFP+ / SFP28:** `1000base-x-sfp`, `10gbase-x-sfpp`,
  `25gbase-x-sfp28`.
- **QSFP:** `40gbase-x-qsfpp`, `100gbase-x-qsfp28`, `400gbase-x-qsfpdd`.
- **Logical:** `virtual` (SVIs, loopbacks, subinterfaces), `lag` (bond or
  port-channel), `bridge`.
- **Management:** the real name (`mgmt0`, `iDRAC`) with `mgmt_only: true`,
  usually `1000base-t`.

If you are unsure, ask — the value has to be one NetBox recognises, and
`netbox_write` will reject anything else locally.

## Cable types (cheat sheet)

- **Copper Ethernet:** `cat5e`, `cat6`, `cat6a`, `cat7`, `cat8`.
- **Fiber:** `smf`, `smf-os1`, `smf-os2`, `mmf-om3`, `mmf-om4`, `mmf-om5`.
- **Direct attach / active optical:** `dac-passive`, `dac-active`, `aoc`.
- **Power:** `power`. Console runs are usually recorded as `cat5e`/`cat6`.

Infer from the ports: short SFP+/SFP28 links are usually `dac-passive`; longer
or QSFP links are fiber; `1000base-t`/`10gbase-t` are copper.

## IP and prefix hygiene

- Give an IP the **host subnet mask** (`10.20.30.5/24`), not `/32`. Reserve
  `/32` (v4) and `/128` (v6) for loopbacks and true host routes.
- Point-to-point links: `/31` (v4) or `/127` (v6) is standard; `/30` is the
  older convention.
- Set the device's `primary_ip4`/`primary_ip6` after assigning the management
  IP — it is what NetBox and downstream tooling use to reach the device.
- `status: dhcp` for DHCP-assigned addresses; `reserved` for gateways and held
  addresses.
- Put addresses in the right `vrf` when the environment is not a single global
  table; mismatched VRFs produce phantom overlap warnings.

## VLANs

Keep VIDs consistent with any site scheme already in use. Put VLANs in a VLAN
group scoped to the site or fabric so VIDs are unique where they need to be,
give operational VLANs an `ipam.role` (OOBM, Prod, DMZ) for filtering, and
create the matching prefix with its `vlan` set.

## Tenancy

In a multi-customer or multi-department environment, set `tenant` consistently
on sites, devices, prefixes and VLANs — it powers the per-tenant views. Tenants
are a normal object type (`tenancy.tenant`), so you can look one up by slug or
create one when the user asks.

## General

- **`description` vs `comments`:** a short label in `description` (it shows in
  list views), longer notes in `comments` (Markdown). Offer both.
- **Tags** (`extras.tag`) are real objects with `name` + `slug`. Apply existing
  ones by slug; only create a new tag definition if the user asks for it.
- Prefer setting a few fields consistently across every object over filling
  every field once.
