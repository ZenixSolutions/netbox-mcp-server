/**
 * The hand-maintained deprecation table, and its one job: telling a caller
 * something NetBox will not.
 *
 * Two properties are load-bearing and are what these tests are really about.
 *
 *  1. REACHABILITY. Every entry is keyed on an object-type key this server
 *     DERIVES, not on Django's `app_label.model`. `/api/virtualization/interfaces/`
 *     derives `virtualization.interface`, so an entry keyed on the Django name
 *     `virtualization.vminterface` would be silently unreachable — present in the
 *     table, never emitted, and nobody would notice. So every entry is walked
 *     through `netbox_describe` end to end.
 *  2. ADVISORY. The table adds notes. It does not gate, refuse or rewrite
 *     anything: NetBox's token permissions are the only authority over what may
 *     be written. The control type here is byte-identical to the deprecated one
 *     apart from its key, which turns "adds only" into an assertion rather than
 *     a claim.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  DEPRECATIONS,
  deprecationNote,
  deprecationsFor,
} from "../../src/schema/deprecations.js";
import { BRIEF_TRUTHINESS_NOTE, describeObjectType } from "../../src/schema/describe.js";
import type { JsonSchemaNode, OpenApiDocument } from "../../src/schema/openapi.js";
import { createSchemaProviderFromDocument } from "../../src/schema/provider.js";
import { buildRegistry, type RegistryEntry } from "../../src/schema/registry.js";
import type {
  Deprecation,
  DescribeResult,
  Operation,
  SchemaProvider,
} from "../../src/schema/types.js";

vi.mock("../../src/client.js", () => ({
  getClient: () => ({
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    del: vi.fn(),
    raw: vi.fn(),
  }),
}));

const { registerLayeredTools } = await import("../../src/tools/layered/index.js");

// --------------------------------------------------------------------------
// A synthetic instance shaped like the endpoints the table talks about.
// --------------------------------------------------------------------------

interface TypeSpec {
  app: string;
  slug: string;
  /** Component base name, e.g. `VLAN` -> `WritableVLANRequest` + `VLAN`. */
  model: string;
  write: Record<string, JsonSchemaNode>;
  required?: string[];
  /** Read-only properties the read component carries; e.g. `mac_address`. */
  readOnly?: string[];
  /** Omit the collection POST to model a read-only viewset (4.5 terminations). */
  writable?: boolean;
}

const SITE_FK: JsonSchemaNode = {
  oneOf: [{ type: "integer" }, { $ref: "#/components/schemas/BriefSiteRequest" }],
  nullable: true,
};

const TYPES: TypeSpec[] = [
  { app: "dcim", slug: "sites", model: "Site", write: { name: { type: "string" } } },
  {
    app: "dcim",
    slug: "inventory-items",
    model: "InventoryItem",
    write: { name: { type: "string" }, part_id: { type: "string" } },
    required: ["name"],
  },
  {
    app: "dcim",
    slug: "inventory-item-roles",
    model: "InventoryItemRole",
    write: { name: { type: "string" } },
  },
  {
    app: "dcim",
    slug: "inventory-item-templates",
    model: "InventoryItemTemplate",
    write: { name: { type: "string" } },
  },
  {
    app: "dcim",
    slug: "interfaces",
    model: "Interface",
    // Stock 4.6.8 strips read-only properties from *Request components, so
    // `mac_address` is simply ABSENT from the write schema. The note is the
    // only thing that explains the absence.
    write: { name: { type: "string" }, primary_mac_address: { type: "integer" } },
    readOnly: ["mac_address"],
  },
  {
    app: "virtualization",
    slug: "interfaces",
    // Derives `virtualization.interface`: `VMInterface` does not pluralise to
    // `interfaces`, so the slug wins. This is the trap the table is keyed for.
    model: "VMInterface",
    write: { name: { type: "string" }, primary_mac_address: { type: "integer" } },
    readOnly: ["mac_address"],
  },
  {
    app: "ipam",
    slug: "vlans",
    model: "VLAN",
    write: { vid: { type: "integer" }, site: SITE_FK, group: { type: "integer" } },
    required: ["vid"],
  },
  {
    // The control: same components, same shape, a key the table says nothing
    // about. Everything except the deprecation notes must match `ipam.vlan`.
    app: "ipam",
    slug: "xlans",
    model: "VLAN",
    write: { vid: { type: "integer" }, site: SITE_FK, group: { type: "integer" } },
    required: ["vid"],
  },
  {
    app: "dcim",
    slug: "modules",
    model: "Module",
    // `local_context_data` was removed in 4.6.3 and is therefore not here.
    write: { module_bay: { type: "integer" }, serial: { type: "string" } },
  },
  {
    app: "dcim",
    slug: "front-ports",
    model: "FrontPort",
    // `rear_port` / `rear_port_position` were removed in 4.5.
    write: { name: { type: "string" }, positions: { type: "integer" } },
  },
  { app: "users", slug: "tokens", model: "Token", write: { key: { type: "string" } } },
];

/** A 4.4-era instance: cable terminations were still writable. */
const CABLE_TERMINATION: TypeSpec = {
  app: "dcim",
  slug: "cable-terminations",
  model: "CableTermination",
  write: { cable: { type: "integer" }, termination_id: { type: "integer" } },
};

function pathsFor(spec: TypeSpec): Record<string, unknown> {
  const write = `Writable${spec.model}Request`;
  const patched = `PatchedWritable${spec.model}Request`;
  const body = (ref: string): Record<string, unknown> => ({
    requestBody: {
      content: {
        "application/json": { schema: { $ref: `#/components/schemas/${ref}` } },
      },
    },
  });
  const collection: Record<string, unknown> = {
    get: {
      description: `Get a list of ${spec.model} objects.`,
      parameters: [
        { in: "query", name: "q", schema: { type: "string" } },
        { in: "query", name: "name", schema: { type: "string" } },
        { in: "query", name: "name__ic", schema: { type: "string" } },
        { in: "query", name: "brief", schema: { type: "boolean" } },
      ],
    },
  };
  if (spec.writable !== false) collection["post"] = body(write);
  const detail: Record<string, unknown> = {
    get: {
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${spec.model}` },
            },
          },
        },
      },
    },
  };
  if (spec.writable !== false) {
    detail["put"] = body(write);
    detail["patch"] = body(patched);
    detail["delete"] = {};
  }
  return {
    [`/api/${spec.app}/${spec.slug}/`]: collection,
    [`/api/${spec.app}/${spec.slug}/{id}/`]: detail,
  };
}

function componentsFor(spec: TypeSpec): Record<string, JsonSchemaNode> {
  const readProperties: Record<string, JsonSchemaNode> = {
    id: { type: "integer", readOnly: true },
    ...spec.write,
  };
  for (const name of spec.readOnly ?? []) {
    readProperties[name] = { type: "string", readOnly: true, nullable: true };
  }
  const written: Record<string, JsonSchemaNode> = {
    [`Writable${spec.model}Request`]: {
      type: "object",
      ...(spec.required ? { required: spec.required } : {}),
      properties: spec.write,
    },
    [`PatchedWritable${spec.model}Request`]: { type: "object", properties: spec.write },
    [spec.model]: { type: "object", properties: readProperties },
  };
  return written;
}

function documentFor(specs: TypeSpec[]): OpenApiDocument {
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, JsonSchemaNode> = {
    BriefSiteRequest: { type: "object", properties: { name: { type: "string" } } },
  };
  for (const spec of specs) {
    Object.assign(paths, pathsFor(spec));
    Object.assign(schemas, componentsFor(spec));
  }
  return {
    info: { title: "NetBox REST API", version: "4.6.8" },
    paths,
    components: { schemas },
  } as OpenApiDocument;
}

const document = documentFor([...TYPES, CABLE_TERMINATION]);
const registry = buildRegistry(document);

function entryFor(key: string): RegistryEntry {
  const entry = registry.types.get(key);
  if (!entry) throw new Error(`no object type ${key} was derived`);
  return entry;
}

function described(key: string, operation: Operation): DescribeResult {
  return describeObjectType(registry, entryFor(key), operation);
}

// --------------------------------------------------------------------------
// The tool-level harness: "reachable through netbox_describe" means the tool.
// --------------------------------------------------------------------------

const Outcome = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  isError: z.boolean().optional(),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
});

interface ToolOutcome {
  text: string;
  isError: boolean;
  notes: string[];
}

async function connect(schema: SchemaProvider): Promise<Client> {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerLayeredTools(server, schema);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function callDescribe(
  client: Client,
  objectType: string,
  operation: Operation,
): Promise<ToolOutcome> {
  const parsed = Outcome.parse(
    await client.callTool({
      name: "netbox_describe",
      arguments: { object_type: objectType, operation },
    }),
  );
  const notes = z.array(z.string()).catch([]).parse(parsed.structuredContent?.["notes"]);
  return {
    text: parsed.content[0]?.text ?? "",
    isError: parsed.isError === true,
    notes,
  };
}

let client: Client;

beforeEach(async () => {
  client = await connect(createSchemaProviderFromDocument(document));
});

afterEach(async () => {
  await client.close();
});

// --------------------------------------------------------------------------

describe("the table itself", () => {
  it("keeps target and objectType consistent", () => {
    for (const entry of DEPRECATIONS) {
      expect(
        entry.target === entry.objectType ||
          entry.target.startsWith(`${entry.objectType}.`),
      ).toBe(true);
    }
  });

  it("cites a source for every claim", () => {
    for (const entry of DEPRECATIONS) {
      expect(entry.source).toMatch(/^https:\/\/(github\.com|netboxlabs\.com)\//);
      expect(entry.since.length).toBeGreaterThan(0);
      expect(entry.useInstead.length).toBeGreaterThan(20);
    }
  });

  it("names each target exactly once", () => {
    const targets = DEPRECATIONS.map((entry) => entry.target);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("does not state a removal version it cannot back up", () => {
    // The inventory-item removal version (5.0) exists only in the tracking
    // issue. Presenting it as documented would be repeating something NetBox
    // has never published.
    for (const entry of DEPRECATIONS) {
      if (entry.removedIn !== undefined) {
        expect(entry.removalCertainty).toBeDefined();
      }
      if (entry.removalCertainty === "issue-only") {
        expect(deprecationNote(entry)).toContain("ONLY in the NetBox tracking issue");
        expect(deprecationNote(entry)).toContain('"a future NetBox release"');
      }
    }
    const inventory = DEPRECATIONS.find((entry) => entry.target === "dcim.inventoryitem");
    expect(inventory?.removalCertainty).toBe("issue-only");
    expect(
      DEPRECATIONS.find((e) => e.target === "ipam.vlan.site")?.removalCertainty,
    ).toBe("unannounced");
    expect(DEPRECATIONS.find((e) => e.target === "users.token")?.removalCertainty).toBe(
      "announced-in-docs",
    );
    // 4.5's notes said v4.7; the 4.6 docs moved it to v5.0.
    expect(DEPRECATIONS.find((e) => e.target === "users.token")?.removedIn).toBe("5.0");
  });
});

describe("reachability", () => {
  /**
   * The test that would have caught `virtualization.vminterface`. Each entry is
   * walked all the way through the tool; a key that does not derive fails here
   * rather than becoming dead data.
   */
  it("surfaces every table entry through netbox_describe", async () => {
    const readOnlyOnThisInstance = new Set<string>();
    for (const entry of DEPRECATIONS) {
      const fieldLevel = entry.target !== entry.objectType;
      const operation: Operation = fieldLevel ? "create" : "list";
      const result = await callDescribe(client, entry.objectType, operation);
      expect(result.isError, `${entry.target} did not describe`).toBe(false);
      // Presence-aware: a field-level note now reads against the instance's
      // own field list, so compare on the stable head rather than the whole
      // rendered string.
      const head = deprecationNote(entry).split(". ")[0] ?? "";
      expect(
        result.notes.some((note) => note.startsWith(head)),
        `${entry.target} produced no note`,
      ).toBe(true);
      expect(result.text).toContain(entry.source);
      readOnlyOnThisInstance.add(entry.objectType);
    }
    // Sanity: the walk actually visited every distinct type in the table.
    expect(readOnlyOnThisInstance.size).toBe(
      new Set(DEPRECATIONS.map((entry) => entry.objectType)).size,
    );
  });

  it("keys the VM interface on the DERIVED key, not the Django model name", () => {
    expect(registry.types.has("virtualization.interface")).toBe(true);
    expect(registry.types.has("virtualization.vminterface")).toBe(false);
    expect(deprecationsFor("virtualization.interface", "create")).toHaveLength(1);
    expect(deprecationsFor("virtualization.vminterface", "create")).toHaveLength(0);
  });

  it("goes quiet, rather than wrong, once NetBox removes the write path", async () => {
    // On 4.5+ `/api/dcim/cable-terminations/` has no POST, so no object type is
    // derived and the entry has nothing to attach to. That is the intended
    // behaviour: the warning fires on 4.4 and earlier, where it is actionable.
    const modern = documentFor([...TYPES, { ...CABLE_TERMINATION, writable: false }]);
    expect(buildRegistry(modern).types.has("dcim.cabletermination")).toBe(false);
    const legacy = await callDescribe(client, "dcim.cabletermination", "create");
    expect(legacy.isError).toBe(false);
    expect(legacy.text).toContain("a_terminations");
  });
});

describe("where a note appears", () => {
  it("warns on READ operations too, not only writes", () => {
    // A caller listing inventory items in order to migrate them off should be
    // told why it is listing them.
    for (const operation of ["list", "get", "create", "update", "delete"] as const) {
      const result = described("dcim.inventoryitem", operation);
      expect(result.notes[0], `missing on ${operation}`).toContain(
        "DEPRECATED: Object type `dcim.inventoryitem`",
      );
      expect(result.deprecations).toHaveLength(1);
    }
  });

  it("puts a field-level note only where the field can be sent", () => {
    for (const operation of ["create", "update"] as const) {
      expect(described("ipam.vlan", operation).notes[0]).toContain("`site`");
    }
    for (const operation of ["list", "get", "delete"] as const) {
      const result = described("ipam.vlan", operation);
      expect(result.notes.join(" ")).not.toContain("DEPRECATED");
      expect(result.deprecations).toBeUndefined();
    }
  });

  it("puts deprecations first, where they will be read", () => {
    const result = described("dcim.interface", "create");
    expect(result.notes[0]).toMatch(/^DEPRECATED: Field `mac_address`/);
    expect(result.notes.length).toBeGreaterThan(1);
    expect(result.notes.slice(1).join(" ")).not.toContain("DEPRECATED");
  });

  it("says nothing at all about a type the table does not name", () => {
    for (const operation of ["list", "get", "create", "update", "delete"] as const) {
      const result = described("dcim.site", operation);
      expect(result.deprecations).toBeUndefined();
      expect(result.notes.join(" ")).not.toContain("DEPRECATED");
      expect(result.notes.join(" ")).not.toContain("REMOVED");
    }
  });
});

describe("the mac_address silent no-op", () => {
  const interfaces = ["dcim.interface", "virtualization.interface"] as const;

  it("names the replacement field and the two-step write", () => {
    for (const key of interfaces) {
      const note = described(key, "create").notes[0] ?? "";
      expect(note).toContain("SILENTLY IGNORED");
      expect(note).toContain("HTTP 200 with no error and no effect");
      expect(note).toContain("dcim.macaddress");
      expect(note).toContain("/api/dcim/mac-addresses/");
      expect(note).toContain("assigned_object_type");
      expect(note).toContain("assigned_object_id");
      expect(note).toContain("primary_mac_address");
    }
  });

  it("does not claim reading or filtering by MAC changed", () => {
    expect(described("dcim.interface", "create").notes[0]).toContain(
      "FILTERING by mac_address still works",
    );
  });

  it("explains a field the derived schema cannot even show", () => {
    // 4.6.8 strips read-only properties from *Request components, so
    // `mac_address` is absent from the write field list entirely. Without the
    // note there is nothing to tell a model why its remembered field vanished.
    const create = described("dcim.interface", "create");
    expect(create.fields.map((field) => field.name)).not.toContain("mac_address");
    expect(create.notes.join(" ")).toContain("mac_address");
  });
});

describe("advisory only", () => {
  /**
   * The whole principle in one assertion: the deprecated type and a control
   * built from the SAME components differ by the deprecation notes and by
   * nothing else. No field withdrawn, no operation withdrawn, no filter lost.
   */
  it("adds notes and changes nothing else", () => {
    for (const operation of ["list", "get", "create", "update", "delete"] as const) {
      const vlan = described("ipam.vlan", operation);
      const control = described("ipam.xlan", operation);
      const added = vlan.deprecations?.length ?? 0;
      // Some notes quote the endpoint, which is the one thing the two types
      // legitimately differ in.
      const normalised = control.notes.map((note) =>
        note.replace(/ipam\/xlans/g, "ipam/vlans"),
      );
      expect(vlan.notes.slice(added)).toEqual(normalised);
      expect(vlan.fields).toEqual(control.fields);
      expect(vlan.filters).toEqual(control.filters);
      expect(vlan.filterNames).toEqual(control.filterNames);
      expect(vlan.dependsOn).toEqual(control.dependsOn);
    }
    expect(entryFor("ipam.vlan").summary.operations).toEqual(
      entryFor("ipam.xlan").summary.operations,
    );
  });

  it("still offers the deprecated field as a writable one", () => {
    const site = described("ipam.vlan", "create").fields.find(
      (field) => field.name === "site",
    );
    expect(site).toBeDefined();
    expect(site?.readOnly).toBe(false);
    // And the FK still contributes its dependency, so a caller that chooses to
    // use it is fully equipped to.
    expect(described("ipam.vlan", "create").dependsOn).toContain("dcim.site");
  });

  it("never refuses a describe for a deprecated type", async () => {
    for (const entry of DEPRECATIONS) {
      if (!registry.types.has(entry.objectType)) continue;
      for (const operation of ["list", "get", "create", "update", "delete"] as const) {
        const result = await callDescribe(client, entry.objectType, operation);
        expect(result.isError, `${entry.objectType}/${operation}`).toBe(false);
      }
    }
  });

  it("exposes no switch to turn any of this into a refusal", () => {
    const surface = Object.keys(
      deprecationsFor("dcim.inventoryitem", "create")[0] ?? {},
    ).join(" ");
    expect(surface).not.toMatch(/block|refuse|deny|enforce/i);
  });
});

const moduleLocalContext = DEPRECATIONS.find(
  (entry) => entry.target === "dcim.module.local_context_data",
);
if (!moduleLocalContext) throw new Error("dcim.module.local_context_data left the table");

describe("removals, which read differently from deprecations", () => {
  it("says REMOVED when a release took the field away outright", () => {
    const note = described("dcim.module", "create").notes[0] ?? "";
    expect(note).toMatch(/^REMOVED: Field `local_context_data` on `dcim.module`/);
    // A patch release is the point: 4.6.3, not a minor bump.
    expect(note).toContain("NetBox REMOVED this in 4.6.3");
    // Nothing to be advisory about — it is already gone.
    expect(note).not.toContain("This is advisory");
  });

  /**
   * This wording was refuted by a live run and is now checked against the
   * instance instead of asserted from the table.
   *
   * The note used to end "It worked on earlier releases, so an instance older
   * than 4.6.3 still accepts it." A contract run against a real NetBox **4.6.0**
   * showed `local_context_data` absent from that instance's derived write
   * schema — NetBox's own release note calls the field "unused", so it was
   * very likely never writable through the API at all. The table knew a version
   * number and inferred behaviour from it; the connected instance is the only
   * evidence actually available.
   */
  it("never claims an older instance accepts a removed field", () => {
    for (const objectType of ["dcim.module", "dcim.frontport"] as const) {
      for (const note of described(objectType, "create").notes) {
        expect(note).not.toMatch(/still accepts it|worked on earlier releases/);
      }
    }
  });

  it("reads a removal against the instance's own field list", () => {
    // Absent: explains why the field is missing rather than guessing.
    const absent = deprecationNote(moduleLocalContext, "absent");
    expect(absent).toContain("That is why it is not in the fields above");
    expect(absent).toContain("this instance does not accept it");

    // Present: the instance predates the removal, so the field works NOW and
    // breaks on upgrade — the one case where a caller needs a timeline.
    const present = deprecationNote(moduleLocalContext, "present");
    expect(present).toContain("predates that release");
    expect(present).toContain("stops working on upgrade");

    // Unknown: no field list to check (an object-type entry, or list/get), so
    // it states the removal and stops.
    const unknown = deprecationNote(moduleLocalContext, "unknown");
    expect(unknown).toContain("NetBox REMOVED this in 4.6.3");
    expect(unknown).not.toContain("this instance");
    expect(unknown).not.toContain("predates");
  });

  it("explains the FrontPort port-mapping replacement", () => {
    const notes = described("dcim.frontport", "create").notes.join(" ");
    expect(notes).toContain("rear_port");
    expect(notes).toContain("rear_port_position");
    expect(notes).toContain("PortMapping");
    expect(notes).toContain("`positions`");
    expect(described("dcim.frontport", "create").deprecations).toHaveLength(2);
  });
});

describe("the brief=false trap", () => {
  /**
   * Not a deprecation and not per-type: NetBox truthiness-tests the raw string,
   * so it applies to every list endpoint on every version. It lives as a plain
   * note on `list` for that reason.
   */
  it("warns on every list description", () => {
    for (const key of ["dcim.site", "ipam.vlan", "dcim.inventoryitem"]) {
      expect(described(key, "list").notes).toContain(BRIEF_TRUTHINESS_NOTE);
    }
    expect(BRIEF_TRUTHINESS_NOTE).toContain("brief=false");
    expect(BRIEF_TRUTHINESS_NOTE).toContain("brief=0");
  });

  it("is not in the deprecation table, because nothing is deprecated", () => {
    for (const entry of DEPRECATIONS) {
      expect(entry.target).not.toContain("brief");
    }
    for (const operation of ["list", "get", "create", "update", "delete"] as const) {
      expect(described("dcim.site", operation).deprecations).toBeUndefined();
    }
  });
});

describe("note rendering", () => {
  it("leads with the verdict and ends with the citation", () => {
    for (const entry of DEPRECATIONS) {
      const note = deprecationNote(entry);
      expect(note).toMatch(/^(DEPRECATED|REMOVED): /);
      expect(note.endsWith(`Source: ${entry.source}`)).toBe(true);
      expect(note).toContain("Use instead:");
    }
  });

  it("states plainly that a still-live deprecation is not being blocked", () => {
    const live: Deprecation[] = DEPRECATIONS.filter(
      (entry) => entry.removedIn === undefined || entry.removedIn !== entry.since,
    );
    expect(live.length).toBeGreaterThan(0);
    for (const entry of live) {
      expect(deprecationNote(entry)).toContain("the call is not blocked or altered here");
    }
  });
});
