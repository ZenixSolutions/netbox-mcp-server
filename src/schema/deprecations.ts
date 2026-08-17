/**
 * NetBox deprecations and removals, encoded by hand.
 *
 * NetBox emits no machine-readable deprecation signal. There is no
 * `Deprecation` or `Sunset` HTTP header, and no `deprecated: true` anywhere in
 * the OpenAPI document, for any of the models below. Verified against NetBox
 * 4.6.8. A client cannot detect any of this at runtime; encoding it by hand is
 * the only option, and that is why this table exists despite the rest of this
 * layer being derived.
 *
 * ADVISORY ONLY. Nothing here blocks, refuses or rewrites a request. The
 * standing principle is "let the API key decide": the token's permissions are
 * the only authority over what may be written. This table adds a note to
 * `netbox_describe` and does nothing else. There is no environment variable and
 * no config switch, because there is nothing to switch off.
 *
 * Maintenance rules:
 *
 *  - Every entry cites a URL. A claim without one does not belong here.
 *  - An entry survives the actual removal. A model whose training data predates
 *    the removal will still reach for the field, and the note is then the only
 *    thing that explains its absence from the derived schema.
 *  - `target` uses this server's own object-type keys, which are derived from
 *    URL slugs and are NOT always Django's `app_label.model`. The VM interface
 *    is the trap: `/api/virtualization/interfaces/` derives
 *    `virtualization.interface`, not `virtualization.vminterface`. Keying an
 *    entry on the Django name would make it silently unreachable.
 */

import type { Deprecation, ObjectTypeKey, Operation } from "./types.js";

/** The NetBox release every entry below was read against. */
export const VERIFIED_AGAINST = "4.6.8";

/**
 * The table.
 *
 * Ordered by object type for reading; `deprecationsFor` sorts what it returns,
 * so this order is not load-bearing.
 */
export const DEPRECATIONS: readonly Deprecation[] = [
  // Inventory items, roles and templates — deprecated in 4.3 by #19004.
  //
  // The removal version is the nuance that matters. v4.3.0's release notes say
  // "may be removed in a future NetBox release"; all three model docs say
  // "planned for removal in a future NetBox release". Only the tracking issue
  // says v5.0.0. So the note must not present 5.0 as documented.
  //   https://github.com/netbox-community/netbox/blob/main/docs/release-notes/version-4.3.md
  //   https://github.com/netbox-community/netbox/blob/main/docs/models/dcim/inventoryitem.md
  //   https://github.com/netbox-community/netbox/issues/19004
  //
  // Still full CRUD in 4.6.8 (`netbox/dcim/api/urls.py`), and NetBox has kept
  // EXTENDING these models since deprecating them — `status` was added to
  // InventoryItem in 4.2, `comments` to InventoryItemRole in 4.5.
  {
    target: "dcim.inventoryitem",
    objectType: "dcim.inventoryitem",
    since: "4.3",
    removedIn: "5.0",
    removalCertainty: "issue-only",
    useInstead:
      "Model the hardware as a module in a module bay: create a module type " +
      "(optionally under a module type profile — a stock 4.6 install already ships " +
      "Fan, Power Supply, Hard Disk, CPU, GPU, Memory and Expansion Card profiles, " +
      "which is where attributes like voltage or capacity go), add a module bay to " +
      "the device or device type, then create the module in that bay. Note the " +
      "structural cost: a module REQUIRES a module bay, so the bay has to exist " +
      "first; there is no direct device attachment as there is for an inventory item.",
    source: "https://github.com/netbox-community/netbox/issues/19004",
  },
  {
    target: "dcim.inventoryitemrole",
    objectType: "dcim.inventoryitemrole",
    since: "4.3",
    removedIn: "5.0",
    removalCertainty: "issue-only",
    useInstead:
      "Module type profiles classify module types (Power Supply, Disk, CPU) and are " +
      "the designated replacement. Be aware the profile lives on the module TYPE, " +
      "not the instance, so two modules of the same type cannot carry different roles.",
    source: "https://github.com/netbox-community/netbox/issues/19004",
  },
  {
    target: "dcim.inventoryitemtemplate",
    objectType: "dcim.inventoryitemtemplate",
    since: "4.3",
    removedIn: "5.0",
    removalCertainty: "issue-only",
    useInstead:
      "Add module bay templates to the device type and instantiate modules of the " +
      "appropriate module type into those bays once the device exists.",
    source: "https://github.com/netbox-community/netbox/issues/19004",
  },

  // Interface / VM interface `mac_address` — read-only since 4.2.
  //
  // The nastiest entry in the table. DRF DROPS read-only fields from an incoming
  // payload rather than rejecting them, so the write returns HTTP 200 with no
  // error and no effect. There is no validation error for a caller to catch and
  // nothing in the response distinguishes success from the silent no-op.
  //   https://github.com/netbox-community/netbox/blob/main/docs/release-notes/version-4.2.md
  //   https://github.com/netbox-community/netbox/blob/main/docs/models/dcim/macaddress.md
  // 4.6.8: `mac_address = serializers.CharField(read_only=True)` on both
  // serializers; the model field is a cached_property over primary_mac_address.
  //
  // The mac_address FILTER is unaffected — it traverses the MACAddress objects —
  // so reads by MAC are unchanged. Only writing moved.
  {
    target: "dcim.interface.mac_address",
    objectType: "dcim.interface",
    since: "4.2",
    useInstead:
      "Two steps. First create the MAC as its own object: POST dcim.macaddress " +
      '(/api/dcim/mac-addresses/) with {"mac_address": "...", "assigned_object_type": ' +
      '"dcim.interface", "assigned_object_id": <interface id>}. Then update the ' +
      "interface, setting `primary_mac_address` to the new MAC's numeric id. " +
      "Reading and FILTERING by mac_address still works and is unchanged.",
    source:
      "https://github.com/netbox-community/netbox/blob/main/docs/models/dcim/macaddress.md",
    silentNoOp: true,
  },
  {
    // `virtualization.interface` — NOT `virtualization.vminterface`; see the
    // module header. The Django model is VMInterface but the derived key
    // follows the URL slug.
    target: "virtualization.interface.mac_address",
    objectType: "virtualization.interface",
    since: "4.2",
    useInstead:
      "Two steps, exactly as for a device interface. First POST dcim.macaddress " +
      '(/api/dcim/mac-addresses/) with {"mac_address": "...", "assigned_object_type": ' +
      '"virtualization.vminterface", "assigned_object_id": <VM interface id>}. Then ' +
      "update the VM interface, setting `primary_mac_address` to the new MAC's id. " +
      "Note the assigned_object_type there is a Django content type, so it is " +
      '"virtualization.vminterface" even though this server\'s object-type key is ' +
      "virtualization.interface.",
    source:
      "https://github.com/netbox-community/netbox/blob/main/docs/models/dcim/macaddress.md",
    silentNoOp: true,
  },

  // VLAN site assignment — deprecated in 4.4 by #19738.
  //
  // No removal version anywhere: the docs say "a future NetBox release" and the
  // 4.4.0 notes have no Breaking Changes section at all. Still a fully writable
  // FK with active validation in 4.6.8 (`netbox/ipam/models/vlans.py`).
  //   https://github.com/netbox-community/netbox/blob/main/docs/models/ipam/vlan.md
  {
    target: "ipam.vlan.site",
    objectType: "ipam.vlan",
    since: "4.4",
    removalCertainty: "unannounced",
    useInstead:
      "Assign the VLAN to a VLAN group (`group`) and scope the GROUP to the site. " +
      "A group can be scoped to a region, site group, site or location, and — the " +
      "reason NetBox prefers it — one grouped VLAN can then serve multiple sites, " +
      "which a direct site FK cannot express.",
    source:
      "https://github.com/netbox-community/netbox/blob/main/docs/models/ipam/vlan.md",
  },

  // Module local_context_data — REMOVED in the 4.6.3 PATCH release by #22357,
  // because dcim.Module no longer inherits ConfigContextModel.
  //
  // In the table specifically because a patch-level removal is what nobody
  // expects: this worked on 4.6.2 and 404s the field on 4.6.3. Verified absent
  // from ModuleSerializer.Meta.fields in 4.6.8.
  //   https://github.com/netbox-community/netbox/blob/main/docs/release-notes/version-4.6.md
  {
    target: "dcim.module.local_context_data",
    objectType: "dcim.module",
    since: "4.6.3",
    removedIn: "4.6.3",
    removalCertainty: "announced-in-docs",
    useInstead:
      "Nothing on the module replaces it — a module is no longer a config-context " +
      "model at all. Put the data on the parent device's `local_context_data`, or " +
      "use a config context scoped to the device, or a custom field on the module.",
    source:
      "https://github.com/netbox-community/netbox/blob/main/docs/release-notes/version-4.6.md",
  },

  // v1 API tokens — deprecated 4.6.1 by #22128.
  //
  // Note the revision: the 4.5.0 release notes said removal in v4.7; the 4.6
  // docs now say v5.0. The 4.6 docs are the current statement, so cite 5.0.
  //   https://github.com/netbox-community/netbox/blob/main/docs/models/users/token.md
  //   https://github.com/netbox-community/netbox/blob/main/docs/integrations/rest-api.md
  {
    target: "users.token",
    objectType: "users.token",
    since: "4.6.1",
    removedIn: "5.0",
    removalCertainty: "announced-in-docs",
    subject: "Legacy v1 API tokens (`users.token`)",
    useInstead:
      "Issue v2 tokens and authenticate with `Authorization: Bearer nbt_<KEY>.<TOKEN>`. " +
      "Existing v1 tokens keep working for now; new ones should be v2. (NetBox 4.5's " +
      "notes originally said removal in 4.7; the 4.6 documentation moved it to 5.0, " +
      "which is the current statement.)",
    source:
      "https://github.com/netbox-community/netbox/blob/main/docs/models/users/token.md",
  },

  // FrontPort rear_port / rear_port_position — REMOVED in 4.5 by #20564,
  // replaced by the PortMapping model.
  //
  // Kept in the table precisely because they are gone: a model that learned the
  // 4.4 shape will send `rear_port` and get a field it cannot find in the
  // derived schema, with no explanation. Verified in 4.6.8 at
  // `netbox/dcim/api/serializers_/device_components.py`.
  //   https://github.com/netbox-community/netbox/blob/main/docs/release-notes/version-4.5.md
  {
    target: "dcim.frontport.rear_port",
    objectType: "dcim.frontport",
    since: "4.5",
    removedIn: "4.5",
    removalCertainty: "announced-in-docs",
    useInstead:
      "Front-to-rear mapping moved to the PortMapping model. The front port now " +
      "carries `rear_ports` (the mappings) and `positions`; the rear port carries " +
      "`front_ports`. Build the mapping there instead of setting a single FK.",
    source:
      "https://github.com/netbox-community/netbox/blob/main/docs/release-notes/version-4.5.md",
  },
  {
    target: "dcim.frontport.rear_port_position",
    objectType: "dcim.frontport",
    since: "4.5",
    removedIn: "4.5",
    removalCertainty: "announced-in-docs",
    useInstead:
      "Positions moved to the PortMapping model with `rear_port`: use the front " +
      "port's `positions` and `rear_ports` fields.",
    source:
      "https://github.com/netbox-community/netbox/blob/main/docs/release-notes/version-4.5.md",
  },

  // Cable terminations became read-only in 4.5 by #20295:
  // `class CableTerminationViewSet(NetBoxReadOnlyModelViewSet)`. POST, PATCH and
  // DELETE answer 405.
  //   https://github.com/netbox-community/netbox/blob/main/docs/release-notes/version-4.5.md
  //
  // On 4.5+ this entry is inert BY DESIGN: with no POST on the collection the
  // registry does not derive an object type at all, so there is nothing to
  // describe and nothing false is claimed. It fires on 4.4 and earlier, where
  // the write path still exists and the warning is still actionable — which is
  // the only place a warning about it can do any good.
  {
    target: "dcim.cabletermination",
    objectType: "dcim.cabletermination",
    since: "4.5",
    removedIn: "4.5",
    removalCertainty: "announced-in-docs",
    subject: "Writing to `dcim.cabletermination` (POST/PATCH/DELETE now answer 405)",
    useInstead:
      "Set terminations on the cable itself: pass `a_terminations` and " +
      "`b_terminations` when creating or updating a dcim.cable. The " +
      "cable-terminations endpoint remains readable.",
    source:
      "https://github.com/netbox-community/netbox/blob/main/docs/release-notes/version-4.5.md",
  },
];

/** True when the entry describes an outright removal rather than a warning. */
function wasRemoved(deprecation: Deprecation): boolean {
  return (
    deprecation.removedIn !== undefined && deprecation.removedIn === deprecation.since
  );
}

function subjectOf(deprecation: Deprecation): string {
  if (deprecation.subject !== undefined) return deprecation.subject;
  if (deprecation.target === deprecation.objectType) {
    return `Object type \`${deprecation.objectType}\``;
  }
  const field = deprecation.target.slice(deprecation.objectType.length + 1);
  return `Field \`${field}\` on \`${deprecation.objectType}\``;
}

/**
 * The timing sentence.
 *
 * `issue-only` gets its own wording on purpose. Telling a caller that inventory
 * items are "removed in 5.0" would be repeating something NetBox has never
 * published — only its tracking issue says it.
 */
function timingOf(deprecation: Deprecation, presence?: FieldPresence): string {
  if (wasRemoved(deprecation)) {
    const head = `NetBox REMOVED this in ${String(deprecation.removedIn)}.`;
    // Do NOT assert what an older instance does. A live run against 4.6.0
    // refuted exactly that claim: this note said `local_context_data` "worked
    // on earlier releases, so an instance older than 4.6.3 still accepts it",
    // and the field was absent from that instance's derived write schema —
    // NetBox's own note calls it "unused", so it was very likely never
    // writable through the API at all. The connected instance is the only
    // evidence available here, so say what it shows and nothing more.
    if (presence === "absent") {
      return `${head} That is why it is not in the fields above: this instance does not accept it.`;
    }
    if (presence === "present") {
      return (
        `${head} This instance still exposes it, so it predates that release — ` +
        `writing it works now and stops working on upgrade.`
      );
    }
    return head;
  }
  // "Still functional" would be a lie about a silent no-op: the field is still
  // SERVED, it just cannot be written any more.
  const state =
    deprecation.silentNoOp === true
      ? "still served, but READ-ONLY,"
      : "still present and functional";
  const head = `Deprecated since NetBox ${deprecation.since}; ${state} as of ${VERIFIED_AGAINST}.`;
  if (
    deprecation.removedIn === undefined ||
    deprecation.removalCertainty === "unannounced"
  ) {
    return `${head} No removal version has been announced.`;
  }
  if (deprecation.removalCertainty === "issue-only") {
    return (
      `${head} Removal is targeted at ${deprecation.removedIn}, but that version is ` +
      `stated ONLY in the NetBox tracking issue — the release notes and the model ` +
      `documentation commit to nothing beyond "a future NetBox release".`
    );
  }
  return `${head} The NetBox documentation states removal in ${deprecation.removedIn}.`;
}

/**
 * Render one entry as a note.
 *
 * Deliberately blunt at the front: this is the string that has to survive a
 * model skimming a long describe result.
 */
/**
 * Whether the connected instance's derived schema actually carries the field
 * this entry names. `unknown` covers the cases where there is nothing to check
 * against — an object-type-level entry, or a `list`/`get` description, neither
 * of which has a write field list.
 */
export type FieldPresence = "present" | "absent" | "unknown";

export function deprecationNote(
  deprecation: Deprecation,
  presence: FieldPresence = "unknown",
): string {
  const parts: string[] = [
    `${wasRemoved(deprecation) ? "REMOVED" : "DEPRECATED"}: ${subjectOf(deprecation)}.`,
    timingOf(deprecation, presence),
  ];
  if (deprecation.silentNoOp === true) {
    parts.push(
      "A write is SILENTLY IGNORED: the field is read-only, and DRF drops read-only " +
        "fields from a payload rather than rejecting them, so the request returns " +
        "HTTP 200 with no error and no effect. Nothing in the response tells you the " +
        "value was discarded.",
    );
  }
  parts.push(`Use instead: ${deprecation.useInstead}`);
  if (!wasRemoved(deprecation)) {
    parts.push(
      "This is advisory: the call is not blocked or altered here, and NetBox's own " +
        "token permissions remain the only authority over what may be written.",
    );
  }
  parts.push(`Source: ${deprecation.source}`);
  return parts.join(" ");
}

/**
 * Entries that apply to one object type and one operation.
 *
 * Object-type-level entries apply to EVERY operation, `list` and `get`
 * included: a caller reading inventory items in order to migrate them off
 * should be told why it is reading them. Field-level entries apply only where a
 * field can actually be sent — create and update.
 */
export function deprecationsFor(
  objectType: ObjectTypeKey,
  operation: Operation,
): Deprecation[] {
  const acceptsFields = operation === "create" || operation === "update";
  return DEPRECATIONS.filter((deprecation) => {
    if (deprecation.objectType !== objectType) return false;
    return deprecation.target === deprecation.objectType || acceptsFields;
  }).sort((a, b) => {
    const rank = (d: Deprecation): number => (d.target === d.objectType ? 0 : 1);
    return rank(a) - rank(b) || a.target.localeCompare(b.target);
  });
}
