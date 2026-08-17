# Deprecations

What NetBox still accepts but you must not write, what was removed outright, and
the writes that fail silently. Checked against NetBox 4.6.8 (released
2026-08-11) by reading the shipped serializers, filtersets and models, not by
inferring from release notes.

**There is no machine-readable deprecation signal anywhere in the NetBox API.**
No `Deprecation` or `Sunset` header, no `deprecated: true` in the OpenAPI schema,
no warning in a 200 response. A deprecated field looks exactly like a current one
in anything derived from that schema, so knowledge of it has to be carried by
hand. Where `netbox_describe` shows a deprecation note, it is hand-maintained and
**advisory only** — it does not block the write, and the token's permissions
remain the only authority over what may be written. This file is the reasoning
behind those notes, plus the parts a per-field note cannot express: what to model
instead, and where to stop and ask.

## Inventory items — never create one, reading stays allowed

**The rule: never create a `dcim.inventoryitem`, `dcim.inventoryitemrole` or
`dcim.inventoryitemtemplate`. Model the part as a module in a module bay
instead.** This applies even when the user asks for an inventory item by name —
say what you are doing differently and why, then propose the module.

**Reading existing inventory items stays allowed and is expected.** Audit and
migration both require it, and refusing to read would block the very work that
gets rid of them. Read them, list them, filter them, report on them freely. The
ban is on `create`. An `update` to an item that already exists is acceptable
when the user is correcting data on hardware they have not migrated yet; a
`delete` is fine as the last step of a migration, with the usual confirmation.

### The status of the deprecation, stated accurately

- **Deprecated in NetBox 4.3** (#19004): "The use of inventory items has been
  deprecated in favor of modules."
- **Fully functional in 4.6.8.** All three endpoints — `/api/dcim/inventory-items/`,
  `/api/dcim/inventory-item-roles/`, `/api/dcim/inventory-item-templates/` —
  still offer full CRUD, and no serializer field has been stripped. NetBox has
  kept extending them since deprecating them: `status` was added to inventory
  items in 4.2, `comments` to inventory item roles in 4.5. Nothing will break
  today.
- **Removal at 5.0 appears only in the tracking issue.** The 4.3 release notes
  and all three model docs say only that they "may be removed in **a future
  NetBox release**". Issue #19004 is the sole source for v5.0.0, and there is no
  published 5.0 date. Say it that way. Do not present 5.0 as documented, and do
  not tell a user their data has a deadline it does not have.
- **No migration tooling exists.** #19004 mentions that "some automated tooling"
  may assist; none ships in 4.6.8 and no migration guide is published.
  Conversion is manual.

The argument for the ban is not urgency, it is consistency: a source of truth
with half its transceivers as inventory items and half as modules answers no
question correctly.

One stale NetBox doc contradicts this — `devicetype.md` still says line cards
"should be modeled as modules **or inventory items**". That sentence predates the
4.3 deprecation and was not updated. Three other docs plus the deprecation banner
say modules. Treat `devicetype.md` as stale.

## What to model instead

| The user says                              | Model as                                                             |
| ------------------------------------------ | -------------------------------------------------------------------- |
| SFP, QSFP, transceiver, optic, DAC         | Module in a module bay, `{module}` interface template                |
| Breakout optic                             | Module with several `{module}/N` interface templates                 |
| Line card, supervisor, expansion card      | Module in a module bay; no interfaces on the chassis device type     |
| Fan, PSU, hard disk, SSD, CPU, GPU, memory | Module with a **module type profile** and **no component templates** |
| A spare on a shelf, unracked stock         | `plugins.inventory.asset` — see the gaps below                       |

The mechanics are in `modular-hardware.md`. Two points specific to the
componentless parts:

**NetBox 4.6 ships default module type profiles for exactly this set.** A fresh
install already has `Fan`, `Power Supply`, `Hard Disk`, `CPU`, `GPU`, `Memory`
and `Expansion Card`. Read `dcim.moduletypeprofile` and reuse one before creating
anything. A profile can also declare a JSON schema of custom attributes — input
voltage for a PSU, clock speed for a CPU, capacity for a disk — which is the
designated replacement for what people used inventory item fields for.

**The module type carries the profile and no component templates at all.** A PSU
produces no interfaces, no power ports, nothing. Pass
`replicate_components: false` on the module create (4.6, #20123).

### The structural cost — say it out loud

`Module.module_bay` is a **required OneToOne**. Unlike an inventory item, which
attaches straight to a device, **every module must occupy a module bay**.
Converting N inventory items therefore means creating N module bays first — PSU
slots, fan trays, drive bays, CPU sockets — that did not exist in the model
before.

The maintainers' position is that this is correct and that bays should be defined
on the type and instantiated automatically; they did not accept that any class of
part cannot be given a bay. So create the bay. But **tell the user you are
creating it**, in the plan, by name. It is a visible modelling artifact appearing
in their rack elevations and device views, and they should approve it rather than
discover it.

## The four honest gaps — stop and ask

NetBox has **no replacement** for these four. When a request lands on one, do not
invent an answer, do not quietly pick the nearest field, and do not fall back to
creating an inventory item. Say which gap you have hit, say what the options are,
and let the user decide.

**1. `discovered` (bool).** InventoryItem has a flag distinguishing
auto-discovered hardware from hand-entered hardware. **Module has no equivalent
at all.** If the user's workflow depends on it, the honest options are a custom
field on `dcim.module` or a tag — both are their decision, not yours.

**2. Per-instance role.** `InventoryItemRole` is assigned per object. The nearest
analog, `ModuleTypeProfile`, lives on the **type**, so two modules of the same
type cannot carry different roles. A maintainer's position is that module bay
labels plus profiles "more than replace" inventory item roles; that is a claim
about the general case, not a mapping for a specific per-instance role scheme.
Ask what the roles are actually used for before proposing anything.

**3. The `component` generic FK — a transceiver in a fixed, non-modular port
that already has an interface.** InventoryItem can point at a specific interface
or port. The module approach **inverts the relationship**: the module creates the
interface rather than attaching to a pre-existing one. For a device whose ports
are fixed and already modelled as static interfaces, there is no documented
answer. Raised in NetBox discussion #19094 and unresolved there. Converting the
port to a module bay is possible but destroys the existing interface and any
cable on it — present that cost and let the user choose.

**4. A spare part on a shelf.** A Module requires both a device and a bay, so
**core NetBox cannot model an uninstalled module.** Also raised in #19094;
unresolved. This instance has the `netbox_inventory` plugin (2.6.0), which covers
it — route spares and stock to `plugins.inventory.asset`. Prefer an asset whose
hardware type is `module_type`, so that installing it links to a `dcim.module`;
an asset with `inventoryitem_type` installs onto a `dcim.inventoryitem`, which is
the deprecated model.

## Migrating inventory items to modules

Do this only when the user asks for it, and one device at a time unless they
explicitly want a batch.

1. **Read the existing items:** `dcim.inventoryitem` filtered by `device_id`.
   Note `name`, `manufacturer`, `part_id`, `serial`, `asset_tag`, `role`,
   `discovered`, and the `component` link if set.
2. **Check the four gaps.** If any item carries a `discovered` flag, a role that
   varies within a type, or a `component` link, stop and ask before proceeding.
3. **Resolve or create the module type profile** — reuse a shipped one where it
   fits.
4. **Create the module type** per distinct part: manufacturer, model, part
   number, profile.
5. **Create the module bay** on the device, `name` and `position` both set. This
   is the new object; name it in the plan.
6. **Create the module** with `device`, `module_bay`, `module_type`, carrying the
   `serial` and `asset_tag` across. `replicate_components: false` for a part with
   no components.
7. **Delete the inventory item** last, with its `display` string as `confirm` and
   the user's explicit go-ahead — or leave it and change nothing, if they would
   rather keep the record until the whole fleet is converted. Do not delete
   without asking.

## Other live traps

### Writes that silently do nothing

- **`dcim.interface.mac_address` and `virtualization.interface.mac_address`.**
  Read-only since 4.2. DRF **drops** read-only fields rather than rejecting them,
  so a PATCH sending `mac_address` returns **HTTP 200 with no error and no
  effect**. There is nothing to catch. The correct path is to create a
  `dcim.macaddress` with the address plus `assigned_object_type: "dcim.interface"`
  and `assigned_object_id`, then set the interface's `primary_mac_address` to the
  new id. `netbox_write` rejects `mac_address` locally, which is the only thing
  standing between you and a silent no-op. A MAC that is currently an interface's
  primary cannot be reassigned without clearing the primary designation first.
  The `mac_address` **filter** still works on both interfaces and devices —
  reading by MAC is unchanged.
- **`?brief=0` and `?brief=false` _enable_ brief mode.** NetBox tests the raw
  query string for truthiness, and the strings `"0"` and `"false"` are both
  truthy. Only omitting the parameter (or an empty value) disables it. Emit
  `brief: true` or omit it entirely; never send a falsy-looking value.

### Deprecated, still writable

- **`ipam.vlan.site`.** Deprecated in 4.4 (#19738) and still a fully writable FK
  in 4.6.8 with active validation. **No removal version has been announced** —
  the docs say only "a future NetBox release". Use a **VLAN group** instead: it
  enforces VID uniqueness within a scope and supports assigning a VLAN to
  multiple sites, which direct site assignment cannot. Propose the group; do not
  refuse the field if the user insists on it, but tell them it is deprecated.

### Removed — these fail outright

- **`dcim.module.local_context_data`** — removed in the **4.6.3 patch release**
  (#22357), not a minor bump. Worked on ≤4.6.2. Device still has the field;
  module does not.
- **`dcim.frontport.rear_port` and `rear_port_position`** — removed in 4.5
  (#20564). Replaced by the `PortMapping` model: a front port now has `positions`
  (integer) and `rear_ports` (a list of mappings), and a rear port has
  `front_ports`. A patch-panel build that sets `rear_port` on a front port fails
  on 4.5+. Describe `dcim.frontport` before building panels.
- **`/api/dcim/cable-terminations/` write methods** — read-only since 4.5
  (#20295); POST/PATCH/DELETE return 405. Set terminations on the cable via
  `a_terminations` / `b_terminations`.
- **`/api/extras/object-types/`** — removed in 4.5 (#19898). It is
  `/api/core/object-types/`. Changelog resources moved from `extras` to `core`
  back in 4.1.
- **`dcim.device.device_role`** — removed in 4.0. The field and the
  `device_role`/`device_role_id` filters are both gone; use `role` / `role_id`.
  **Do not generalise this rename.** `extras.configcontext` went the other way:
  its `role`/`role_id` filters were removed in 4.1 and the surviving names are
  `device_role` / `device_role_id`.

### Fields moved to a scope, filters that did not move with them

Several models lost a direct `site` FK in 4.2/4.3 in favour of a generic scope or
parent:

| Model                         | Removed write field         | Write instead                             |
| ----------------------------- | --------------------------- | ----------------------------------------- |
| `ipam.prefix`                 | `site`                      | `scope_type` + `scope_id`                 |
| `virtualization.cluster`      | `site`                      | `scope_type` + `scope_id`                 |
| `circuits.circuittermination` | `site`, `provider_network`  | `termination_type` + `termination_id`     |
| `ipam.service`                | `device`, `virtual_machine` | `parent_object_type` + `parent_object_id` |
| `tenancy.contact`             | `group` (FK)                | `groups` (many-to-many)                   |

**Read filters and write fields are separate concerns here.** The `site` and
`site_id` **filters** on prefixes, clusters, circuit terminations and wireless
LANs all still work in 4.6 — they are backed by denormalized cache columns. So
`netbox_read ipam.prefix filters:{site_id: 3}` is correct while
`netbox_write ipam.prefix data:{site: 3}` is not. Do not "fix" a working filter
because the write field moved.

### Renamed filters removed in 4.1

Both names worked in 4.0; the old one was dropped in 4.1 (#15410).

| Scope                                 | Gone                             | Use                                |
| ------------------------------------- | -------------------------------- | ---------------------------------- |
| All device/module component templates | `devicetype_id`, `moduletype_id` | `device_type_id`, `module_type_id` |
| `extras.configcontext`                | `role`, `role_id`                | `device_role`, `device_role_id`    |
| `ipam.service`                        | `ipaddress`, `ipaddress_id`      | `ip_address`, `ip_address_id`      |
| `ipam.vlangroup`                      | `sitegroup`, `clustergroup`      | `site_group`, `cluster_group`      |

Also removed in 4.1: `ipam.vlangroup.min_vid` / `max_vid`, replaced by
`vid_ranges` as `[[start, end], …]`.

## 4.6 additions worth using

Not deprecations, but they change what correct usage looks like.

- **`replicate_components` / `adopt_components`** — write-only booleans on
  `dcim.module` (#20123). `replicate_components: false` for a module type with no
  component templates; `adopt_components` takes over matching components that
  already exist rather than colliding.
- **`add_tags` / `remove_tags`** — write-only fields on every taggable serializer
  (#21771). Use them to add one tag without having to read, merge and re-send the
  whole `tags` list.
- **`?start=` cursor pagination** (#21363) — the efficient alternative to
  `?offset=` when walking a large collection. `offset` still works and is what
  `netbox_read` reports as `next_offset`.
- **ETag / `If-Match` on detail endpoints** (#21356) — optimistic concurrency for
  an update that must not clobber someone else's change.
