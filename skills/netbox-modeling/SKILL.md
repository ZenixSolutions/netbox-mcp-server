---
name: netbox-modeling
description: >-
  Model and build out infrastructure in NetBox through the five netbox MCP tools
  — sites, racks, hardware (manufacturers, device types, platforms), devices,
  NICs/interfaces, cables and wired connections, IPAM (prefixes, IP addresses,
  VLANs, VLAN groups, VRFs, aggregates, IP ranges), tenancy, virtualization, and
  whatever plugins the instance has installed (netbox-inventory assets,
  suppliers, purchases, deliveries). Use this skill whenever the user wants to
  add, create, model, document, wire, cable, connect, rack, provision, lay out,
  update or remove ANYTHING in NetBox — even if they don't say "NetBox"
  explicitly but are clearly describing network/datacenter hardware, cabling, or
  IP addressing that belongs in it. It knows the order things must be built in,
  asks only for what it genuinely needs, recommends standard-practice defaults,
  previews a plan before writing, and never guesses a field name it can look up.
---

# NetBox modeling

You are helping the user build and maintain their NetBox source of truth. NetBox
is a strict relational model: almost every object points at other objects by
numeric id, and a referenced object must exist before anything can reference it.
Your job is to turn a human request ("wire port 12 on the top switch to the
firewall", "add the new Dell server with its four NICs", "carve a /26 for the
DMZ") into the correct sequence of NetBox operations — asking for what is
genuinely required, recommending sensible defaults for the rest, and never
guessing at data that must be exact.

## The five tools

The whole NetBox API is reached through five tools. There is no
`netbox_create_device`; there is `netbox_write` with
`object_type: "dcim.device"`.

| Tool                   | Answers                                        | Key arguments                                                                                |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `netbox_global_search` | "where is the thing called X?"                 | `query`, `resources[]`, `limit_per_resource`, `response_format`                              |
| `netbox_discover`      | "which object types exist here?"               | `query`, `app`                                                                               |
| `netbox_describe`      | "what does this type need for this operation?" | `object_type`, `operation` (list/get/create/update/delete)                                   |
| `netbox_read`          | list or get objects                            | `object_type`, `operation` (list/get), `id`, `filters`, `limit`, `offset`, `response_format` |
| `netbox_write`         | create, update or delete                       | `object_type`, `operation` (create/update/delete), `id`, `data`, `confirm`                   |

`netbox_discover` and `netbox_describe` are generated from the connected
instance's own OpenAPI schema, so they describe **that** instance — its NetBox
version, its plugins, its custom fields. Nothing in this skill overrides what
they return. If this skill and `netbox_describe` disagree, `netbox_describe` is
right.

## The loop

**1. Understand the intent.** Identify which NetBox object types the request
touches and whether you are creating, updating, deleting, or just reading. One
human request usually spans several objects: "add this server" means a device
plus its interfaces plus, often, an IP address.

**2. Find the types once.** Call `netbox_discover` with a `query` or an `app`
(`dcim`, `ipam`, `tenancy`, `virtualization`, `circuits`, `plugins/inventory`)
to get the `object_type` keys you need. Do not assume a key — keys are derived
from the live instance and a few are not the obvious ones (VM interfaces are
`virtualization.interface`; object permissions are `users.permission`). One or
two `netbox_discover` calls should cover an entire task; do not call it per
object.

**3. Resolve context — look things up, never invent ids.** Use
`netbox_global_search` when you have a name and not a type, and `netbox_read`
with `operation: "list"` and filters when you know the type. Resolve every name
the user gave you (site, rack, device type, role, VLAN, target interface) to a
numeric id, and check whether what they are asking for already exists. If a name
matches two objects, show both and ask which.

**4. Describe before you write.** Call `netbox_describe` with the
`object_type` and the operation you intend, once per type per task. It returns
the required fields, the optional fields with their exact enum values, the
read-only fields you must not send, and `depends on` — the object types that
must exist first. Guessing field names instead does not save the round-trip:
`netbox_write` validates `data` against the same schema locally and hands you
this description back on failure.

**5. Present the plan and get confirmation.** Before any write, lay out exactly
what you will do: each object to be created, updated or deleted, in dependency
order, with concrete field values showing resolved names **and** their ids, and
clearly marked as new or existing. Then stop and wait for an explicit go-ahead.
This is a production system of record. If the user said "just plan it", "dry
run", or "don't write yet", stop here and hand over the plan.

**6. Execute in dependency order.** Call `netbox_write` bottom-up so referenced
objects exist before their referencers. Capture the `id` from each create and
feed it into the next call. If a call fails, read the error — it names the
offending field — fix the input and retry. Do not continue as though it
succeeded.

**7. Verify and report.** Read back what you created or changed, with names and
ids, so the user has a record and can spot anything wrong.

## Golden rules

- **Confirm before writing.** No `create`, `update` or `delete` without the user
  approving the plan first. Reads never need approval — do them freely.
- **Deleting requires the object's own `display` value.** `netbox_write` with
  `operation: "delete"` needs `confirm` set to exactly the object's current
  `display` string. Read the object first (`netbox_read`, `operation: "get"`),
  copy `display`, confirm the deletion with the **user**, then call. NetBox
  cascades deletes — removing a site can remove its racks, devices and prefixes
  — and there is no undo.
- **Describe once per type per task, not once per object.** Creating twelve
  interfaces is one `netbox_describe` on `dcim.interface` and twelve
  `netbox_write` calls.
- **Take filter names from `netbox_describe`, never from memory.** NetBox
  silently ignores query parameters it does not recognise: a misspelled filter
  would return the entire unfiltered collection while looking like a successful
  narrow search. `netbox_read` rejects unknown filter names locally for exactly
  this reason, so a guess costs you a round-trip.
- **References are numeric ids.** `netbox_describe` marks them
  ("references dcim.site; accepts a numeric ID"). Look the object up first.
- **Check before you create.** NetBox does not dedupe. Two "Rack 12"s or two
  identical prefixes are painful to unwind.
- **Send enum values, not labels.** `netbox_describe` lists the exact values
  (`active`, `4-post-cabinet`, `10gbase-x-sfpp`). A GET returns choice fields as
  `{"value": "active", "label": "Active"}` — write back the `value`.
- **Never send read-only fields.** `id`, `url`, `display`, `created`,
  `last_updated`, every `*_count`, and per-type computed fields like
  `dcim.interface.mac_address`. `netbox_describe` lists them; `netbox_write`
  rejects them.
- **Slugs:** when a create needs a slug and the user did not give one, derive it
  from the name (lowercase, spaces and dots to hyphens, drop other punctuation)
  and show it in the plan so they can correct it.
- **Surface API errors verbatim.** A NetBox 400 names the offending field.
  Relay it rather than paraphrasing it away.

## Dependency order (build bottom-up)

`netbox_describe` returns `depends on` mechanically for one type. This is the
conventional order for a whole modelling task, which the schema cannot tell you:

```
Region ─▶ Site ─▶ Location ─▶ Rack ─▶ Device ─▶ Interface ─▶ Cable
                    (site)  │           ▲  ▲        │
Manufacturer ─▶ Device Type ─┘           │        └─▶ IP Address ─▶ (device.primary_ip4)
Manufacturer ─▶ Platform ────────────────┤
Device Role ─────────────────────────────┘

VRF ─▶ Prefix ─▶ IP Address              VLAN Group ─▶ VLAN ─▶ (prefix.vlan)
RIR ─▶ Aggregate                         IPAM Role ─▶ (prefix / vlan / iprange .role)
Tenant Group ─▶ Tenant ─▶ (almost anything .tenant)

netbox-inventory plugin:  Supplier ─▶ Purchase ─▶ Delivery ─▶ Asset
                          Manufacturer ─▶ Inventory Item Type ─▶ Asset
```

Items on the left must exist before items on the right can reference them. Names
in parentheses are the field on the right-hand object that holds the reference.

Two orderings that are easy to get wrong:

- A **cable** goes last. Both terminations must already exist, and an occupied
  termination cannot take a second cable.
- A device's **primary IP** is set after the fact: create the interface, create
  the IP assigned to that interface, then `update` the device with
  `primary_ip4`/`primary_ip6`.

## Reference files — read the one that fits the task

- **`references/tool-surface.md`** — exact argument shapes, filter grammar,
  pagination, `brief`, JSON output, error self-healing, and how to keep the
  round-trip count down. Read this before your first `netbox_read` in a session.
- **`references/build-order.md`** — per object type: what it is for, what NetBox
  requires, what is worth setting, and the version-specific traps (prefix
  `scope_type`/`scope_id`, rack `form_factor`, VLAN group `vid_ranges`, cable
  terminations, MAC addresses). Read the relevant section before building a type
  you are not certain about.
- **`references/workflows.md`** — step-by-step playbooks for the common jobs:
  cabling two endpoints, adding a device with NICs, modeling new hardware,
  allocating IPs, VLANs and prefixes, rack intake, asset intake, bulk creation,
  and deletion. Follow the matching playbook rather than improvising.
- **`references/conventions.md`** — the defaults to recommend: naming, slugs,
  statuses, role colors, interface and cable type values, IP and prefix hygiene,
  and when to use a device vs module vs inventory item vs asset.
