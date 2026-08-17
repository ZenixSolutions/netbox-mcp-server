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
- **Module bays:** set `name` and `position` on every bay. The `name` is the
  human label (`Eth1/5`, `Slot 1`, `PSU 1`); the `position` is what `{module}`
  substitutes into generated interface names, so it is the part that has to be
  right (`Eth1/5`, `1`, `1`). For a module presenting several ports, the house
  standard is a `/` separator — `{module}/1` giving `Eth1/5/1`. NetBox's own
  guide uses `:` instead; the divergence is noted in `modular-hardware.md`. Match
  an existing convention on the instance over either.
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

## Device vs module vs asset

- **Device** — anything that mounts and has its own network identity and ports:
  switch, router, server, firewall, PDU. Zero-U things like PDUs are still
  devices, with `u_height: 0` on the device type.
- **Module** — **any field-replaceable part in a module bay.** Line cards and
  supervisors, but also transceivers, DACs, breakout optics, PSUs, fans, disks,
  CPUs, GPUs and memory. A module in a bay is the answer for essentially every
  sub-component of a device. Parts with ports carry interface templates using
  the `{module}` token; parts without ports carry a **module type profile** and
  no component templates at all.
- **Device bay** — not a module bay. Use it only for hardware with its own
  management plane isolated from the parent, i.e. blade servers. Never for line
  cards.
- **Inventory item** — **deprecated since NetBox 4.3; never create one.** It was
  the old way to record an SFP, a fan or a PSU on a device. Model those as
  modules. Existing inventory items stay readable and you should read them
  freely — audits and migrations need to. See `deprecations.md` for the ban, the
  four cases where no module equivalent exists, and the migration steps.
- **Asset** (netbox-inventory) — the _physical unit_ tracked for procurement and
  lifecycle (in stock, RMA, spare, owned by a tenant), independent of whether it
  is installed. Core NetBox cannot model an uninstalled module — `Module` needs
  both a device and a bay — so an asset is the only place a spare on a shelf can
  live. Use assets for stock and spares and a device or module for what is
  actually racked and cabled; an asset can point at the installed object. Prefer
  `module_type` as the asset's hardware type over `inventoryitem_type`.

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

For a pluggable port the `type` goes on the **module type's** interface template,
not on the device type, and it should describe the **transceiver actually in
use** rather than the cage — a 10G optic in a SFP+ port is `10gbase-x-sfpp`.

## Cable types (cheat sheet)

- **Copper Ethernet:** `cat5e`, `cat6`, `cat6a`, `cat7`, `cat8`.
- **Fiber:** `smf`, `smf-os1`, `smf-os2`, `mmf-om3`, `mmf-om4`, `mmf-om5`.
- **Direct attach / active optical:** `dac-passive`, `dac-active`, `aoc`.
- **Power:** `power`. Console runs are usually recorded as `cat5e`/`cat6`.

Infer from the ports: short SFP+/SFP28 links are usually `dac-passive`; longer
or QSFP links are fiber; `1000base-t`/`10gbase-t` are copper.

Leave the cable `profile` unset unless the user has asked for lane-level tracing
of a breakout. It is optional, and omitting it keeps the familiar tracing
behaviour. When it is wanted, read the enum from `netbox_describe` — there are 26
values and the NetBox docs list 4.

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

The group is now the standard route: assigning a VLAN directly to a `site` was
deprecated in 4.4 and a group can span multiple sites, which direct assignment
cannot.

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
