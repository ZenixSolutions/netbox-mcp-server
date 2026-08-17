# Object reference and build order

What each object is for, what NetBox actually requires, what is worth setting,
and the traps. Field lists here are a head start for planning and for asking the
user the right questions — **`netbox_describe` is the authority** for the
connected instance, and it is what you must call before writing.

Almost every object also accepts `description` (a short one-liner shown in
lists), `comments` (long-form Markdown), `tags` and `custom_fields`. They are
distinct fields; offer both `description` and `comments` when relevant.

"Requires" below means required on `create`. `update` is a PATCH and requires
nothing but the field you are changing.

## Contents

- DCIM organization: region, site group, site, location, rack
- Hardware catalog: manufacturer, device type, module type profile, module type,
  platform
- Devices and components: device role, device, interface, module bay, module,
  other components
- Connections: cable
- IPAM: VRF, RIR, aggregate, prefix, IP range, IP address, VLAN group, VLAN, role
- Tenancy: tenant, contact
- netbox-inventory plugin: asset, supplier, purchase, delivery, item type
- Version traps

---

## DCIM organization

### `dcim.region` / `dcim.sitegroup`

Geographic (region, nestable via `parent`) and functional (site group) groupings
of sites. Requires `name`, `slug`. Create one only if the user asks for it;
otherwise resolve an existing one by name.

### `dcim.site`

A physical location — datacenter, office, POP.

- **Requires:** `name`, `slug`.
- **Worth setting:** `status` (one of `planned`, `staging`, `active`,
  `decommissioning`, `retired`; defaults to `active` — it is _not_ a required
  field), `region`, `group`, `tenant`, `facility`, `physical_address`,
  `time_zone` (IANA), `description`.

### `dcim.location`

A subdivision within a site: room, floor, cage, row. Nestable via `parent`.

- **Requires:** `name`, `slug`, `site`.
- **Worth setting:** `status` (same values as site), `parent`, `tenant`.

### `dcim.rack`

An equipment rack, always in a site and optionally in a location.

- **Requires:** `name`, `site`.
- **Worth setting:** `status` (`reserved`, `available`, `planned`, `active`,
  `deprecated`), `location`, `role`, `u_height` (default 42), `width`
  (10/19/21/23, default 19), `form_factor`, `serial`, `asset_tag`.
- **`form_factor`:** `2-post-frame`, `4-post-frame`, `4-post-cabinet`,
  `wall-frame`, `wall-frame-vertical`, `wall-cabinet`,
  `wall-cabinet-vertical`. **This field was `type` before NetBox 4.0.**
- **Physical:** `weight` + `weight_unit` (`kg`/`g`/`lb`/`oz`), `max_weight`,
  `outer_width`/`outer_height`/`outer_depth` + `outer_unit` (`mm`/`in`),
  `mounting_depth`, `airflow`, `desc_units`, `starting_unit`.
- `rack_type` (`dcim.racktype`) is a predefined model that supplies the physical
  dimensions; set it instead of the individual measurements when one exists.

---

## Hardware catalog

### `dcim.manufacturer`

A vendor (Cisco, Dell, APC). Shared by device types, module types and platforms.
**Requires:** `name`, `slug`.

### `dcim.devicetype`

A model of hardware. Instances of it are devices.

- **Requires:** `manufacturer`, `model`, `slug` (unique per manufacturer).
- **Worth setting:** `u_height` (0 for zero-U PDUs and shelves, 0.5 increments
  allowed), `is_full_depth`, `part_number`, `airflow`, `weight` +
  `weight_unit` (`kg`/`g`/`lb`/`oz`), `default_platform`,
  `exclude_from_utilization` (for zero-U PDUs).
- **Modular chassis:** `subdevice_role` = `parent` or `child`.
- **Component templates** (`dcim.interfacetemplate`, `dcim.powerporttemplate`,
  `dcim.consoleporttemplate`, …) are separate object types. Creating them on a
  device type makes every future device of that model inherit those ports —
  which is usually what the user wants for a model they will deploy repeatedly.
  Offer it; it is real work, so do not do it silently.
- **Pluggable ports are `dcim.modulebaytemplate`, not `dcim.interfacetemplate`.**
  A cage that takes an SFP or a line card gets a module bay with a `name` **and**
  a `position`; the interface arrives with the module. A chassis device type has
  no interface templates at all. See `modular-hardware.md`.

### `dcim.moduletypeprofile`

A classification for module types — `Fan`, `Power Supply`, `CPU` — that can also
declare a JSON schema of custom attributes (a PSU's input voltage, a disk's
capacity). Requires `name`. NetBox 4.6 ships `Fan`, `Power Supply`, `Hard Disk`,
`CPU`, `GPU`, `Memory` and `Expansion Card` by default; read the type and reuse
one before creating anything.

### `dcim.moduletype` / `dcim.module`

Field-replaceable hardware that slots into a module bay: transceivers and DACs,
line cards and supervisors, PSUs, fans, disks, CPUs. This is the replacement for
inventory items, and the mechanics are in `modular-hardware.md` — read it before
building any of them.

- **`dcim.moduletype` requires** `manufacturer` and `model`. Worth setting
  `part_number` and `profile`.
- **Interface templates go on the module type**, with `module_type` set instead
  of `device_type`, and their names use the `{module}` token. A module type for a
  part with no ports — a PSU or a fan — carries **no component templates at all**.
- **`dcim.module` requires** `device`, `module_bay` and `module_type`. Worth
  setting `serial`, `asset_tag`.
- **`replicate_components` / `adopt_components`** (write-only, 4.6) control what
  happens to the module's components on install. Pass
  `replicate_components: false` for a part with none.
- **`local_context_data` was removed from `dcim.module` in the 4.6.3 patch
  release.** It worked on ≤4.6.2. The device still has it; the module does not.

### `dcim.platform`

An OS/firmware family (EOS, NX-OS, Junos, Proxmox). **Requires:** `name`,
`slug`. Optionally `manufacturer` to scope it.

---

## Devices and components

### `dcim.devicerole`

The function a device serves: core-switch, leaf, firewall, server.

- **Requires:** `name`, `slug`.
- **Worth setting:** `color` (6 hex digits, no `#`), `vm_role` (only if virtual
  machines use the role too), `parent` (roles are nestable in 4.3+).

### `dcim.device`

A physical instance of a device type at a site. The central DCIM object.

- **Requires:** `device_type`, `role`, `site`. (`name` is strongly recommended
  but is genuinely optional — NetBox allows unnamed devices.)
- **Placement:** `location`, `rack`, `position` (the lowest U it occupies; omit
  for unracked or zero-U), `face` (`front` or `rear`).
- **Identity:** `name`, `serial`, `asset_tag`, `status` (`offline`, `active`,
  `planned`, `staged`, `failed`, `inventory`, `decommissioning`; default
  `active`).
- **Worth setting:** `platform`, `tenant`, `airflow` (`front-to-rear`,
  `rear-to-front`, `left-to-right`, `right-to-left`, `side-to-rear`,
  `rear-to-side`, `bottom-to-top`, `top-to-bottom`, `passive`, `mixed`).
- **Primary IPs:** `primary_ip4` / `primary_ip6` are set in a follow-up
  `update`, after the IP exists and is assigned to one of the device's
  interfaces. `primary_ip` (no suffix) is read-only — do not send it.
- **Also:** `oob_ip`, `cluster`, `virtual_chassis` + `vc_position` +
  `vc_priority`, `config_template`, `latitude`/`longitude`,
  `local_context_data`.
- Racking needs the rack to exist and to have enough free U at `position`.

### `dcim.interface`

A network port on a device — the NIC.

- **Requires:** `device`, `name`, `type`.
- **Worth setting:** `enabled` (default true), `label`, `mtu`, `mgmt_only` for
  management ports, `description`.
- **Layer 2:** `mode` (`access`, `tagged`, `tagged-all`), `untagged_vlan`,
  `tagged_vlans` (array of ids).
- **Aggregation:** `lag` (the parent LAG interface's id — create the LAG
  interface first), `parent` for subinterfaces, `bridge`, `mark_connected`.
- **Physical:** `speed` (kbps), `duplex` (`half`/`full`/`auto`), `wwn`,
  `poe_mode` (`pd`/`pse`), `poe_type`, `vrf`.
- **MAC addresses (4.2+):** `mac_address` and `mac_addresses` on the interface
  are **read-only** — `netbox_write` rejects them locally, which is the only
  thing standing between you and a silent no-op: NetBox itself answers **200 with
  no effect** for a PATCH that sets `mac_address`. A MAC is its own object type,
  `dcim.macaddress`: create it with the address, `assigned_object_type:
"dcim.interface"` and `assigned_object_id`, then set the interface's
  `primary_mac_address` to the new id. The `mac_address` **filter** still works
  for reads.
- `cable`, `connected_endpoints` and the other connection fields are read-only.
  Cabling is done by creating a `dcim.cable`.
- **`module`** is set by NetBox when a module generates the interface. Do not
  create an interface by hand for a port that should come from a module — see
  `modular-hardware.md`.

### `dcim.modulebay`

The slot a module goes into: an SFP cage, a line card slot, a PSU bay, a drive
bay. Instantiated automatically on every device built from a device type that has
`dcim.modulebaytemplate` entries; create it directly on a `device` when you are
adding a slot to a device that already exists.

- **Requires:** `device`, `name`.
- **Always set `position` as well.** `{module}` in a module type's component
  template is replaced by the bay's `position`, not its `name`. A blank position
  makes the token resolve to nothing and the generated interface name is silently
  wrong. `position` must be unique within the device.
- Since 4.6 a bay template can also sit on a `module_type`, which is how an SFP
  inside a line card is modelled.

### Other components

`dcim.consoleport`, `dcim.consoleserverport`, `dcim.powerport`,
`dcim.poweroutlet`, `dcim.frontport`, `dcim.rearport`, `dcim.devicebay` are all
first-class object types with the same create/update/delete surface as
interfaces.

- **Front and rear ports** are what patch panels are made of. **The mapping
  changed in 4.5:** `dcim.frontport.rear_port` and `rear_port_position` were
  removed in favour of the `PortMapping` model. A front port now carries
  `positions` and `rear_ports`; a rear port carries `front_ports`. Describe
  `dcim.frontport` before building a panel — the old two-field shape fails.
- **`dcim.devicebay`** is for hardware with its own management plane, isolated
  from the parent: blade servers. It is **not** for line cards, which depend on
  the parent's control plane and are modules.
- **`dcim.inventoryitem`** exists and still works, but is **deprecated since 4.3
  — never create one.** Read it freely; model the part as a module instead. See
  `deprecations.md`.

---

## Connections

### `dcim.cable`

A physical connection between two termination points. This is what "wire X to
Y" creates.

- **NetBox requires no field on create** — which means a cable with no
  terminations will be created happily and connect nothing. Always send both.
- **`a_terminations` and `b_terminations`:** each an array (usually one entry)
  of `{ "object_type": "dcim.interface", "object_id": 79 }`.
  - The `object_type` **inside a termination** is NetBox's own content-type
    string: `dcim.interface`, `dcim.frontport`, `dcim.rearport`,
    `dcim.consoleport`, `dcim.consoleserverport`, `dcim.powerport`,
    `dcim.poweroutlet`, `circuits.circuittermination`. These usually match the
    keys `netbox_discover` returns, but they are a different namespace — they
    are data you put in `data`, not the tool's own `object_type` argument.
  - `object_id` is the numeric id of the port. Resolve it first.
  - **`dcim.module` and `dcim.modulebay` are not termination types.** Cables
    terminate on interfaces (and the other port types above), never on a module.
    If the interface does not exist yet because the optic is not installed,
    install the module first.
  - **`/api/dcim/cable-terminations/` is read-only from 4.5** — writes to
    `dcim.cabletermination` return HTTP 405. Terminations go on the cable.
- **`profile` (4.5+):** declares how many parallel lanes the cable carries and
  how they map end to end, letting NetBox trace one lane instead of the whole
  cable. `breakout-1c4p-4c1p` is the classic QSFP→4×SFP breakout. Assignment is
  **optional** and omitting it preserves legacy tracing. There are 26 values in
  4.6.8 and NetBox's own model doc lists 4 — **take the enum from
  `netbox_describe`, never from memory.** Do not confuse it with
  `dcim.cablebundle` (4.6), which groups cables managed as one physical run and
  explicitly does **not** affect tracing or connectivity.
- **Worth setting:** `type` (`cat5e`, `cat6`, `cat6a`, `cat7`, `cat8`, `mmf`,
  `mmf-om3`, `mmf-om4`, `mmf-om5`, `smf`, `smf-os1`, `smf-os2`, `dac-passive`,
  `dac-active`, `aoc`, `power`, `usb`, coax variants), `status` (`connected`,
  `planned`, `decommissioning`; default `connected`), `label`, `color`,
  `length` + `length_unit` (`km`, `m`, `cm`, `mi`, `ft`, `in`), `tenant`.
- **Both endpoints must already exist**, and each can hold only one cable. If a
  port is already occupied, NetBox refuses — the existing cable has to be
  deleted first, which is a `netbox_write` delete with its own confirmation.

---

## IPAM

### `ipam.vrf`

A routing table / private address space. Objects with no VRF are in the global
table.

- **Requires:** `name`.
- **Optional:** `rd`, `enforce_unique`, `tenant`, `import_targets` /
  `export_targets` (arrays of `ipam.routetarget` ids).

### `ipam.rir` / `ipam.aggregate`

An aggregate is a top-level block allocated by an RIR (or a private-space
marker); prefixes live under it conceptually.

- **RIR requires:** `name`, `slug`.
- **Aggregate requires:** `prefix` (CIDR), `rir`.
- Optional: `tenant`, `date_added` (YYYY-MM-DD).

### `ipam.prefix`

An IPv4/IPv6 subnet.

- **Requires:** `prefix` (CIDR, e.g. `10.0.0.0/24`).
- **Worth setting:** `status` (`container`, `active`, `reserved`, `deprecated`;
  default `active`), `role` (an `ipam.role`), `tenant`, `description`,
  `is_pool`, `mark_utilized`.
- **Scope (changed in 4.2):** there is no `site` field. To attach a prefix to a
  site, location, region or site group, set **both** `scope_type`
  (`dcim.site`, `dcim.location`, `dcim.region`, `dcim.sitegroup`) and
  `scope_id`. The `scope` field itself is read-only.
- `vrf` scopes it to a routing table; omit for global. `vlan` links it to the
  VLAN it serves.
- `status: container` marks a supernet you will subdivide; leaf subnets are
  `active`.

### `ipam.iprange`

A contiguous span, e.g. a DHCP pool.

- **Requires:** `start_address`, `end_address` — **both with a mask**, e.g.
  `10.0.0.10/24`.
- **Worth setting:** `status` (`active`, `reserved`, `deprecated`), `role`,
  `vrf`, `tenant`, `mark_utilized`.

### `ipam.ipaddress`

A single address, optionally bound to an interface.

- **Requires:** `address` (CIDR — the host's subnet mask, not `/32` unless it
  really is a loopback or host route).
- **Assignment:** set **both** `assigned_object_type` and
  `assigned_object_id`. `assigned_object_type` is NetBox's content-type string —
  `dcim.interface` for a device NIC, `virtualization.vminterface` for a VM NIC
  (note that the _object type key_ for the VM NIC is `virtualization.interface`;
  the content-type string is not the same namespace). `assigned_object` itself
  is read-only.
- **Worth setting:** `status` (`active`, `reserved`, `deprecated`, `dhcp`,
  `slaac`), `role` (`loopback`, `secondary`, `anycast`, `vip`, `vrrp`, `hsrp`,
  `glbp`, `carp`), `dns_name`, `vrf`, `tenant`, `nat_inside`.
- **Primary IP flow:** create and assign the IP, then `update` the device with
  `primary_ip4`/`primary_ip6` = the new IP's id.

### `ipam.vlangroup`

A namespace enforcing VLAN-id uniqueness within a scope.

- **Requires:** `name`, `slug`.
- **Scope:** `scope_type` + `scope_id` (e.g. `dcim.site` + the site's id).
- **`vid_ranges`:** allowed VID ranges as `[start, end]` pairs, e.g.
  `[[1, 999], [2000, 2999]]`. Replaces the pre-4.x `min_vid`/`max_vid`.

### `ipam.vlan`

- **Requires:** `vid` (1-4094), `name`.
- **Worth setting:** `status` (`active`, `reserved`, `deprecated`), `group`,
  `role`, `tenant`.
- **`site` is deprecated as of 4.4.** It is still a writable FK in 4.6.8 and no
  removal version has been announced, but direct site assignment has been
  superseded by **VLAN groups**, which enforce VID uniqueness within a scope and
  can span multiple sites. Put the VLAN in a group; mention the deprecation if
  the user asks for `site` specifically. VLANs did **not** move to the
  `scope_type`/`scope_id` model that prefixes use — the group carries the scope.
- `qinq_role` / `qinq_svlan` exist for Q-in-Q.

### `ipam.role`

A taxonomy applied to prefixes, VLANs and IP ranges ("OOBM", "Backups").
**Requires:** `name`, `slug`. Optional `weight` (default 1000).

---

## Tenancy

### `tenancy.tenant` / `tenancy.tenantgroup`

An owner, customer or department that most objects can belong to via `tenant`.
**Requires:** `name`, `slug`. Set `tenant` consistently across sites, devices,
prefixes and VLANs in a multi-customer environment — it powers per-tenant views.

### `tenancy.contact` / `tenancy.contactrole` / `tenancy.contactassignment`

People attached to objects. A contact requires `name`; an assignment ties a
contact to an object and a role.

---

## netbox-inventory plugin

Present only if the plugin is installed — confirm with `netbox_discover`
(`app: "plugins/inventory"`). Tracks physical hardware through its lifecycle,
independent of whether it is currently installed.

### `plugins.inventory.asset`

A physical piece of hardware: in stock, installed, or retired.

- **Requires:** `status` (typically `stored`, `used`, `retired` — the instance
  may customize these, so read the enum from `netbox_describe`) **and exactly
  one hardware type:** `device_type`, `module_type`, `inventoryitem_type` or
  `rack_type`. The one you pick sets the asset's `kind`.
- **Prefer `module_type` over `inventoryitem_type`** for transceivers, PSUs,
  disks and line cards. Installing a `module_type` asset links it to a
  `dcim.module`; an `inventoryitem_type` asset links to a `dcim.inventoryitem`,
  which is the deprecated model.
- **Identity:** `serial`, `asset_tag`, `name`.
- **Assignment:** `device` / `module` / `inventoryitem` / `rack` — links the
  asset to the installed object, and must match the hardware type.
- **Provenance:** `owning_tenant`, `tenant`, `contact`, `storage_location`,
  `purchase`, `delivery`, `role`, `warranty_start` / `warranty_end`.

### The procurement chain

- **`plugins.inventory.supplier`** — requires `name`, `slug`.
- **`plugins.inventory.purchase`** — requires `name`, `supplier`, `status`
  (`open`, `partial`, `closed`). Optional `date`.
- **`plugins.inventory.delivery`** — requires `name`, `purchase`. Optional
  `date`, `receiving_contact`.
- **`plugins.inventory.inventoryitemtype`** — a catalog model for non-device
  stock. Requires `manufacturer`, `model`, `slug`. Assets of this kind install
  onto deprecated `dcim.inventoryitem` objects, so use `dcim.moduletype` for
  transceivers and other installable parts and keep this for stock that genuinely
  never becomes a module.
- **`plugins.inventory.inventoryitemgroup`**, **`plugins.inventory.assetrole`** —
  grouping and functional role; require `name` (+ `slug` for the role).

---

## Version traps (NetBox 4.x)

These silently used to work under old field names. `deprecations.md` has the full
ledger, including the writes that return HTTP 200 and do nothing.

- **Prefix location** is `scope_type` + `scope_id`, not `site` (changed in 4.2).
  The `site` / `site_id` **read filters** still work — the write field moved, the
  filter did not.
- **Rack form factor** is `form_factor`, not `type` (changed in 4.0).
- **VLAN group** uses `vid_ranges` (`[[start, end], …]`), not
  `min_vid`/`max_vid` (changed in 4.1).
- **VLAN site assignment** is deprecated since 4.4; use a VLAN group.
- **Interface MAC** is read-only on the interface since 4.2; MACs are
  `dcim.macaddress` objects. A PATCH sending `mac_address` returns **200 and does
  nothing** — there is no error to catch.
- **Device role** is `role`, not `device_role` (changed in 3.6), and roles
  became nestable in 4.3. Do not generalise the rename: `extras.configcontext`
  went the other way and its surviving filters are `device_role`/`device_role_id`.
- **Cable terminations** are `a_terminations`/`b_terminations` arrays of
  `{object_type, object_id}`, not simple endpoint fields, and
  `dcim.cabletermination` is read-only from 4.5 (405 on write).
- **Front port mapping** is `positions` + `rear_ports` from 4.5;
  `rear_port`/`rear_port_position` were removed.
- **Module `local_context_data`** was removed in the 4.6.3 patch release.
- **Inventory items** are deprecated since 4.3 — read, never create.
- **`brief=0` and `brief=false` enable brief mode.** Send `brief: true` or omit
  it entirely.
- **Choice fields** read back as `{"value", "label"}`; write the bare `value`.
