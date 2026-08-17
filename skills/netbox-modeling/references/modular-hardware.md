# Modular hardware

Transceivers, DACs, breakout optics, line cards, PSUs, fans, disks — anything
that plugs into a slot. This is the file to read before answering "add an SFP to
port 5" or "cable these two switches together", because in a modular model the
obvious answer is the wrong one.

Everything here is checked against NetBox 4.6.8 and NetBox's own guide
_Modeling Pluggable Transceivers_ (shipped for 4.4+). Field names are a head
start — **`netbox_describe` is the authority** for the connected instance.

## The three invariants

**1. An `Interface` never holds a module.** A transceiver, DAC or line card is
never a property of an interface and never a child of one. There is no
`interface.transceiver`, no `interface.module`, no field to put the part number
in. If you are looking for one, you are modelling it wrong.

**2. Modules generate interfaces.** A physically pluggable port is **not** a
static interface template on the baseline Device Type. The Device Type carries a
**Module Bay**; the **Module Type** carries an interface template whose name uses
the `{module}` token; the interface comes into existence only when a module is
instantiated into that bay, and disappears when the module is removed. An empty
cage is an empty bay, not an interface.

**3. Cables terminate on `Interfaces` only** — never on a Module and never on a
Module Bay. `dcim.module` and `dcim.modulebay` are not valid cable termination
types. **The module install always precedes the cable**, because until the module
exists the interface it would terminate on does not.

## `{module}` substitutes the bay's `position`, not its `name`

This is the single easiest thing to get wrong.

A module bay has both a `name` and a `position`. `{module}` in a module type's
component template is replaced by the **`position`** value of the bay the module
is installed into. The `name` is only what the bay is called in the UI.

- **Set both fields on every module bay, always.** A bay with a blank `position`
  makes the token resolve to nothing, and you get an interface literally named
  `eth//1` or `` — silently, with no error.
- A bay named `Slot 1` needs `position = 1` for a template named `eth/{module}/1`
  to render `eth/1/1`.
- `position` is a free-text string, so it can be `1`, `0/0/14`, or `A`. Make it
  the token you actually want inside the interface name.

NetBox's guide states it directly: "an interface template with the name
`et-{module}` being created on a module installed in a bay with position
`0/0/14` will create an interface named `et-0/0/14`."

The bay's `position` must be unique within the device, and it is what you are
really naming when you create the bay. Choose it from the device's own port
numbering.

### Separator: this house standard uses `/`

For a module that presents several ports, this skill names them
`{module}/1`, `{module}/2`, … producing Cisco-idiomatic `Eth1/5/1`, `Eth1/5/2`.

**NetBox's published transceiver guide uses `:` instead** (`{module}:1`,
yielding `Eth1/5:1`). Both work — the token is substituted the same way and the
rest of the name is arbitrary text. The divergence is noted here once so that
anyone cross-referencing the upstream documentation is not confused. Use `/`
throughout unless the user's instance already has a `:` convention in place, in
which case match what is there.

## The three patterns

| Case                                | Device Type                                   | Module Type templates                | Resulting interfaces    |
| ----------------------------------- | --------------------------------------------- | ------------------------------------ | ----------------------- |
| Single pluggable (100G QSFP28, DAC) | Module Bay `Eth1/5`, static interface deleted | `{module}`                           | `Eth1/5`                |
| Breakout optic (QSFP → 4×10G)       | Module Bay `Eth1/5`                           | `{module}/1` … `{module}/4`          | `Eth1/5/1` … `Eth1/5/4` |
| Chassis line card                   | Empty bays `Slot 1`, `Slot 2`; no interfaces  | `eth/{module}/1` … `eth/{module}/48` | `eth/1/1` … `eth/1/48`  |

In all three the Module Bay's `position` is the value the token picks up —
`Eth1/5`, `Eth1/5`, and `1`/`2` respectively.

### Single pluggable port

The bay stands in for the physical cage. The interface template on the module
type is named exactly `{module}` and nothing else, so the interface takes the
bay's position verbatim.

**Delete the static interface template for that port on the Device Type.** If a
baseline `Eth1/5` interface template survives alongside a bay at position
`Eth1/5`, every device built from that type gets an `Eth1/5` interface that no
module produced, and installing a module then fails: NetBox enforces interface
name uniqueness per device, so the module's generated interface collides with
the static one. On a device that already exists, the static interface is already
there — converting it means deleting that interface, and deleting a cable on it
first. Both are visible destructive changes; put them in the plan and get
explicit confirmation.

### Breakout optic

A breakout optic is one module presenting several ports, so the module type
carries several interface templates: `{module}/1` through `{module}/4` for a
QSFP→4×SFP. The bay is still one bay at one position. This is separate from a
breakout _cable_ — see below; both can apply to the same link.

### Chassis line card

The chassis Device Type has **no interfaces at all** and only bays: `Slot 1`
(position `1`), `Slot 2` (position `2`), and so on. All ports arrive with the
line cards. A 48-port line card is one Module Type carrying 48 interface
templates, `eth/{module}/1` … `eth/{module}/48`, which resolve to `eth/1/1` …
`eth/1/48` once installed in the bay at position `1`.

Do not use a Device Bay for this, and do not use a Virtual Chassis. Device bays
are for hardware with its own management plane isolated from the parent — blade
servers. A line card depends on the parent's control plane, so it is a module.
NetBox's `devicebay` and `virtualchassis` docs both rule out line cards
explicitly.

### Nested bays (4.6)

Since 4.6 (#19796) a module type can itself carry module bay templates, which is
what makes "SFPs inside a line card" work. The sub-bay positions use `{module}`
too, and resolve relative to the parent:

- A line card module type declares sub-bay positions `{module}/1`, `{module}/2`.
- Installed into a chassis bay at position `3`, those become `3/1`, `3/2`.
- An SFP module type with interface template `SFP {module}`, installed into
  sub-bay `3/2`, produces the interface `SFP 3/2`.

The chain is Module Bay → Module → Module Bay → Module → Interface, and the
token substitution composes at each level.

## Build order

```
Module Type Profile ─┐
Manufacturer ────────┴─▶ Module Type ─▶ Interface Template  (name contains {module})
                              │
Device Type ─▶ Module Bay Template ─▶ Module Bay ─▶ Module ─▶ Interface ─▶ Cable
                                     (name + position)  ▲
                                                        └── module_type
```

- **`dcim.moduletypeprofile`** — a classification for module types (`Fan`,
  `Power Supply`, `CPU`) that can also declare a JSON schema of custom
  attributes. Requires `name`. Optional but recommended; NetBox ships several by
  default (see `deprecations.md`).
- **`dcim.moduletype`** — requires `manufacturer` and `model`. Worth setting
  `part_number` and `profile`; the profile's declared attributes are carried on
  the module type itself, and `netbox_describe dcim.moduletype create` names that
  field on your instance.
- **`dcim.interfacetemplate` on a module type** — the same object type used for
  device types, but with `module_type` set instead of `device_type`. Requires
  `name` and `type`. Set `type` to the **transceiver actually in use**, not the
  cage: NetBox's interface docs say "Interfaces which employ a removable optic or
  similar transceiver should be defined to represent the type of transceiver in
  use, irrespective of the physical termination to that transceiver."
- **`dcim.modulebaytemplate`** — on a `device_type` (or, for nesting, a
  `module_type`). Requires `name`; **always set `position` too**. Bays declared
  here are instantiated automatically on every device built from the type.
- **`dcim.modulebay`** — the instance, on a `device`. Create one directly when
  you are adding a slot to a device that already exists. Requires `device` and
  `name`; **always set `position`**.
- **`dcim.module`** — requires `device`, `module_bay` and `module_type`. Worth
  setting `serial`, `asset_tag`, `description`, and `status` if the instance
  exposes it (take the enum from `netbox_describe`).
  - **`replicate_components`** (write-only, 4.6, #20123) — pass `false` for a
    module type that has no component templates, e.g. a PSU or a fan.
  - **`adopt_components`** (write-only, 4.6, #20123) — takes over matching
    components that already exist on the device instead of failing on a name
    collision. Useful when retrofitting an existing device; say so in the plan,
    because it changes objects the user did not ask you to touch.
  - **`local_context_data` was removed from `dcim.module` in 4.6.3** (#22357).
    It worked on ≤4.6.2. Never send it.

## Cabling through a module

The full sequence for "cable these two switches together" when either end is a
pluggable port:

1. **Resolve both endpoints and check what is actually there.** Read the
   device's `dcim.modulebay` list as well as its `dcim.interface` list. A bay
   with no module and no interface is an empty cage, not a missing interface.
2. **Verify or create the Module Type**, with its `{module}` interface
   template(s). One module type per optic model, reused across the fleet — check
   before creating.
3. **Install the module into the bay on _both_ devices.** Two `dcim.module`
   creates, one per side. Both are writes and belong in the plan.
4. **Confirm the interfaces materialised.** Re-read `dcim.interface` for each
   device and capture the new numeric ids. Do not assume the generated name —
   read it back. A blank bay `position` shows up here as a mangled name.
5. **Create the `dcim.cable`** with `a_terminations` and `b_terminations`, each
   `{"object_type": "dcim.interface", "object_id": <id>}`.

**`/api/dcim/cable-terminations/` became read-only in NetBox 4.5** (#20295).
Terminations are set on the cable itself through `a_terminations` /
`b_terminations`; a write to `dcim.cabletermination` returns HTTP 405. If you
find yourself reaching for that type to attach a cable, stop — the field goes on
the cable.

If the user asks only for the cable and the optic is missing, say so and propose
the module installs as part of the same plan rather than silently creating a
bare interface.

## Breakout: the module and the cable are two different objects

Both can apply to the same physical link, and they are not substitutes.

**The breakout _optic_** is a module with multiple interface templates — the
second pattern above. It is what creates `Eth1/5/1` … `Eth1/5/4`.

**The breakout _cable_** is, since NetBox 4.5 (#20788), a first-class
`dcim.cable` with a `profile`. A profile declares how many discrete parallel
lanes the cable carries and how they map between the two ends, which lets NetBox
trace an individual lane rather than the cable as a whole. For a QSFP→4×SFP
breakout the value is `breakout-1c4p-4c1p` — one connector with four positions
on the A side, four connectors with one position each on the B side.

- **Assignment is optional.** Omitting `profile` preserves legacy tracing
  behaviour, which is the right choice when the user has not asked for lane-level
  tracing.
- **There are 26 profile values in 4.6.8 and the model documentation lists only 4.** The full set spans single, trunk and breakout families and has been
  extended in patch releases (`breakout-1c2p-2c1p` in 4.5.4,
  `breakout-1c8p-8c1p` in 4.6.2). **Take the enum from
  `netbox_describe dcim.cable create`, never from memory and never from the
  NetBox model docs.** `netbox_write` validates against the instance's own schema
  and will reject anything else locally.

**Do not confuse either with `dcim.cablebundle`** (new in 4.6, #20151). A bundle
groups individual cables that are managed as one physical run — 48 CAT6 cables
between two patch panels. Assignment is optional and, per NetBox's own docs, it
**does not affect cable tracing or connectivity**. It is a labelling convenience,
not a modelling primitive, and it is not suitable for individual fibre strands
inside one cable.

## Modules with no interfaces

A fan, PSU, hard disk, CPU, GPU or memory stick is still a module. It has a
module type profile and **no component templates at all** — see
`deprecations.md` for the profile list NetBox ships by default, the ban on
inventory items, and the bay-creation cost.

## Traps

- **Blank `position` on a module bay.** The token resolves to nothing and the
  generated interface name is wrong, with no error. Set `name` and `position`
  together, every time.
- **A static interface template left on the Device Type** for a port that also
  has a bay. The module install fails on a name collision.
- **Writing to `dcim.cabletermination`.** Read-only since 4.5; returns 405.
- **`local_context_data` on `dcim.module`.** Removed in the 4.6.3 patch release.
- **Assuming the generated interface name.** Read it back after the module
  install and use the id you actually got.
- **Reaching for an inventory item** when a module feels heavy. Don't — see
  `deprecations.md`.
