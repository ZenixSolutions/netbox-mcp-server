/**
 * Layer 2 derivation: write-schema resolution, read-only handling, foreign
 * keys, enums and filter summarisation.
 *
 * The write-schema tests are the important ones. A name-based rule does not
 * fail here — it resolves to the wrong component — so these assert the exact
 * component name that was resolved, not just that something was.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { describeObjectType, FILTER_GRAMMAR } from "../../src/schema/describe.js";
import { refName, type OpenApiDocument } from "../../src/schema/openapi.js";
import {
  buildRegistry,
  type RegistryEntry,
  type SchemaRegistry,
} from "../../src/schema/registry.js";
import type { FieldSpec } from "../../src/schema/types.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/netbox-schema-subset.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as OpenApiDocument;
const registry = buildRegistry(fixture);

function entryFor(key: string, source: SchemaRegistry = registry): RegistryEntry {
  const entry = source.types.get(key);
  if (!entry) throw new Error(`no object type ${key} was derived`);
  return entry;
}

function fieldNamed(fields: FieldSpec[], name: string): FieldSpec {
  const field = fields.find((candidate) => candidate.name === name);
  if (!field) throw new Error(`no field named ${name}`);
  return field;
}

describe("write-schema resolution", () => {
  it("resolves dcim.device to the Writable* component, which no name rule finds", () => {
    // `DeviceRequest` does not exist at all; `DeviceWithConfigContextRequest`
    // does, as the bulk-DELETE payload.
    expect(entryFor("dcim.device").writeSchemaName).toBe(
      "WritableDeviceWithConfigContextRequest",
    );
    expect(entryFor("dcim.device").writeSchemaResolvedFrom).toBe("detail-put");
    expect(fixture.components?.schemas?.["DeviceRequest"]).toBeUndefined();
    expect(fixture.components?.schemas?.["DeviceWithConfigContextRequest"]).toBeDefined();
  });

  it("resolves a type that does NOT use Writable* to its plain *Request", () => {
    // users/permissions is the counter-case: the slug is not the model name
    // and there is no Writable form.
    expect(entryFor("users.permission").writeSchemaName).toBe("ObjectPermissionRequest");
    expect(entryFor("users.permission").readSchemaName).toBe("ObjectPermission");
    expect(fixture.components?.schemas?.["PermissionRequest"]).toBeUndefined();
  });

  it("never resolves dcim.site to SiteRequest, which is the bulk-DELETE payload", () => {
    const site = entryFor("dcim.site");
    expect(site.writeSchemaName).toBe("WritableSiteRequest");
    expect(site.writeSchemaName).not.toBe("SiteRequest");
    // The name a naive `<Model>Request` rule would pick exists — that is the
    // trap. It is the collection DELETE body.
    const bulkDelete =
      fixture.paths?.["/api/dcim/sites/"]?.delete?.requestBody?.content?.[
        "application/json"
      ]?.schema;
    expect(refName(bulkDelete?.items?.$ref)).toBe("SiteRequest");
  });

  it("picks Writable* over a *Request that differs in `required`", () => {
    // In the committed fixture SiteRequest and WritableSiteRequest happen to be
    // byte-identical, so a name bug would be invisible there. 46 of the 65
    // Writable*/plain pairs on stock 4.6.7 are NOT identical and 8 differ in
    // `required` — this reproduces that shape so the bug fails loudly.
    const doc: OpenApiDocument = {
      paths: {
        "/api/extras/custom-fields/": {
          get: { description: "Get a list of custom field objects." },
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/WritableCustomFieldRequest" },
                      {
                        type: "array",
                        items: {
                          $ref: "#/components/schemas/WritableCustomFieldRequest",
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
          delete: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/CustomFieldRequest" },
                  },
                },
              },
            },
          },
        },
        "/api/extras/custom-fields/{id}/": {
          get: {},
          put: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/WritableCustomFieldRequest" },
                },
              },
            },
          },
          delete: {},
        },
      },
      components: {
        schemas: {
          CustomFieldRequest: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" }, type: { type: "string" } },
          },
          WritableCustomFieldRequest: {
            type: "object",
            required: ["name", "type"],
            properties: { name: { type: "string" }, type: { type: "string" } },
          },
        },
      },
    };
    const derived = buildRegistry(doc);
    const entry = derived.types.get("extras.customfield");
    expect(entry?.writeSchemaName).toBe("WritableCustomFieldRequest");
    const result = describeObjectType(
      derived,
      entryFor("extras.customfield", derived),
      "create",
    );
    expect(fieldNamed(result.fields, "type").required).toBe(true);
  });

  it("unwraps the oneOf POST body when there is no detail PUT to read", () => {
    const doc: OpenApiDocument = {
      paths: {
        "/api/dcim/sites/": {
          get: {},
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/WritableSiteRequest" },
                      {
                        type: "array",
                        items: { $ref: "#/components/schemas/WritableSiteRequest" },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        "/api/dcim/sites/{id}/": { get: {} },
      },
      components: {
        schemas: { WritableSiteRequest: { type: "object", properties: {} } },
      },
    };
    const derived = buildRegistry(doc);
    expect(derived.types.get("dcim.site")?.writeSchemaName).toBe("WritableSiteRequest");
    expect(derived.types.get("dcim.site")?.writeSchemaResolvedFrom).toBe(
      "collection-post",
    );
  });
});

describe("read-only fields", () => {
  it("does not offer id/url/created as things a caller supplies", () => {
    const result = describeObjectType(registry, entryFor("dcim.site"), "create");
    const names = result.fields.map((field) => field.name);
    for (const readOnly of ["id", "url", "display", "created", "last_updated"]) {
      expect(names).not.toContain(readOnly);
    }
    // The READ component lists exactly those in `required`
    // (COMPONENT_NO_READ_ONLY_REQUIRED is not set) — which is why the write
    // component is the only legitimate source.
    expect(fixture.components?.schemas?.["Site"]?.required).toContain("id");
    expect(result.fields.map((field) => field.name).sort()).toEqual(
      Object.keys(
        fixture.components?.schemas?.["WritableSiteRequest"]?.properties ?? {},
      ).sort(),
    );
    expect(result.fields.every((field) => !field.readOnly)).toBe(true);
  });

  it("marks a readOnly write property and refuses to call it required", () => {
    // Stock 4.6.7 strips readOnly from every *Request component, but a plugin
    // serializer or a <= 4.3 instance need not.
    const doc: OpenApiDocument = {
      paths: {
        "/api/plugins/demo/things/": {
          get: {},
          post: {
            requestBody: {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/T" } },
              },
            },
          },
        },
        "/api/plugins/demo/things/{id}/": { get: {} },
      },
      components: {
        schemas: {
          T: {
            type: "object",
            required: ["id", "name"],
            properties: {
              id: { type: "integer", readOnly: true },
              name: { type: "string" },
            },
          },
        },
      },
    };
    const derived = buildRegistry(doc);
    const result = describeObjectType(
      derived,
      entryFor("plugins.demo.thing", derived),
      "create",
    );
    expect(fieldNamed(result.fields, "id").readOnly).toBe(true);
    expect(fieldNamed(result.fields, "id").required).toBe(false);
    expect(fieldNamed(result.fields, "name").required).toBe(true);
  });

  it("names the read-only fields in a note so an agent knows why they are rejected", () => {
    const result = describeObjectType(registry, entryFor("dcim.site"), "create");
    expect(result.notes.join(" ")).toMatch(/Read-only.*\bid\b/);
  });
});

describe("foreign keys", () => {
  const create = describeObjectType(registry, entryFor("dcim.device"), "create");

  it("maps oneOf[integer, Brief<X>Request] to refersTo + acceptsId", () => {
    const site = fieldNamed(create.fields, "site");
    expect(site.refersTo).toBe("dcim.site");
    expect(site.acceptsId).toBe(true);
    expect(site.type).toBe("integer");
    expect(site.required).toBe(true);
  });

  it("sees through the allOf + nullable wrapper on an optional FK", () => {
    const primary = fieldNamed(create.fields, "primary_ip4");
    expect(primary.refersTo).toBe("ipam.ipaddress");
    expect(primary.acceptsId).toBe(true);
    expect(primary.nullable).toBe(true);
    expect(primary.required).toBe(false);
  });

  it("produces dependsOn from the resolved FK targets", () => {
    expect(create.dependsOn).toEqual(["dcim.site", "ipam.ipaddress"]);
    // The subset has no dcim/device-types path, so that FK cannot resolve to a
    // key — it must be omitted rather than guessed at.
    expect(fieldNamed(create.fields, "device_type").refersTo).toBeUndefined();
    expect(fieldNamed(create.fields, "device_type").acceptsId).toBe(true);
    expect(fieldNamed(create.fields, "device_type").description).toContain("DeviceType");
  });

  it("treats a to-many relation as an array of ids", () => {
    const tags = fieldNamed(create.fields, "tags");
    expect(tags.type).toBe("array");
    expect(tags.acceptsId).toBe(true);
  });

  it("handles the legacy bare-$ref FK shape from NetBox <= 4.3", () => {
    const doc: OpenApiDocument = {
      paths: {
        "/api/dcim/sites/": { get: {}, post: {} },
        "/api/dcim/sites/{id}/": { get: {} },
        "/api/dcim/devices/": {
          get: {},
          post: {
            requestBody: {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/D" } },
              },
            },
          },
        },
        "/api/dcim/devices/{id}/": { get: {} },
      },
      components: {
        schemas: {
          D: {
            type: "object",
            required: ["site"],
            properties: { site: { $ref: "#/components/schemas/BriefSiteRequest" } },
          },
          BriefSiteRequest: { type: "object", properties: { name: { type: "string" } } },
        },
      },
    };
    const derived = buildRegistry(doc);
    const result = describeObjectType(
      derived,
      entryFor("dcim.device", derived),
      "create",
    );
    expect(fieldNamed(result.fields, "site").refersTo).toBe("dcim.site");
  });
});

describe("enums", () => {
  const create = describeObjectType(registry, entryFor("dcim.device"), "create");

  it("reads the inlined enum array in place — there are no *Enum components", () => {
    expect(fieldNamed(create.fields, "status").enum).toEqual([
      "offline",
      "active",
      "planned",
      "staged",
      "failed",
      "inventory",
      "decommissioning",
    ]);
    const enumComponents = Object.keys(fixture.components?.schemas ?? {}).filter((name) =>
      name.endsWith("Enum"),
    );
    expect(enumComponents).toEqual([]);
  });

  it("keeps the blank member and drops the null one", () => {
    expect(fieldNamed(create.fields, "face").enum).toEqual(["front", "rear", ""]);
  });

  it("warns that the read form is a {value,label} object", () => {
    expect(create.notes.join(" ")).toContain("value");
    expect(fixture.components?.schemas?.["Site"]?.properties?.["status"]?.type).toBe(
      "object",
    );
  });
});

describe("filter summarisation", () => {
  const list = describeObjectType(registry, entryFor("dcim.device"), "list");

  it("cuts 342 parameters down to the 94 suffix-free ones", () => {
    expect(fixture.paths?.["/api/dcim/devices/"]?.get?.parameters).toHaveLength(342);
    expect(list.filters).toHaveLength(94);
    expect(list.filters?.some((filter) => filter.name.includes("__"))).toBe(false);
    expect(list.notes.join(" ")).toContain("248 lookup-suffix variants elided");
  });

  it("keeps the _id forms, which are what layer 3 chains from a create", () => {
    const names = list.filters?.map((filter) => filter.name) ?? [];
    expect(names).toContain("site_id");
    expect(names).toContain("rack_id");
    expect(names).toContain("site");
  });

  it("surfaces the control filters first, then the create-required fields", () => {
    const names = list.filters?.map((filter) => filter.name) ?? [];
    expect(names.slice(0, 4)).toEqual(["q", "id", "limit", "offset"]);
    expect(names.indexOf("site")).toBeLessThan(names.indexOf("latitude"));
  });

  it("replaces the elided variants with one grammar sentence", () => {
    expect(list.filterGrammar).toBe(FILTER_GRAMMAR);
    for (const suffix of [
      "__n",
      "__ic",
      "__isw",
      "__empty",
      "__regex",
      "__gte",
      "__any",
    ]) {
      expect(list.filterGrammar).toContain(suffix);
    }
    expect(list.filterGrammar?.length).toBeLessThan(700);
  });

  /**
   * The summary is what a model reads; it is NOT the valid set. NetBox ignores
   * a query parameter it does not recognise and returns the whole collection,
   * so netbox_read has to reject unknown names itself — and it can only do that
   * against the complete parameter list, because `name__ic` is legitimate and
   * is one of the 248 names the summary drops.
   */
  it("carries the complete parameter set alongside the summary, for validation", () => {
    expect(list.filterNames).toHaveLength(342);
    expect(list.filterNames).toContain("name");
    expect(list.filterNames).toContain("name__ic");
    expect(list.filterNames).toContain("status__n");
    expect(list.filterNames).not.toContain("nmae");
    // Everything shown is also in the validated set; nothing advertised is
    // rejectable.
    for (const filter of list.filters ?? []) {
      expect(list.filterNames).toContain(filter.name);
    }
  });

  it("does not offer a parameter set for the operations that have no filters", () => {
    for (const operation of ["get", "create", "update", "delete"] as const) {
      expect(
        describeObjectType(registry, entryFor("dcim.device"), operation).filterNames,
      ).toBeUndefined();
    }
  });

  it("summarises an enum filter as its value list rather than the glossary", () => {
    const airflow = list.filters?.find((filter) => filter.name === "airflow");
    expect(airflow?.description).toMatch(/^one of: /);
    expect(airflow?.description).not.toContain("\n");
    expect(airflow?.description).not.toContain("null");
  });

  it("leaves fields empty for list, get and delete", () => {
    for (const operation of ["list", "get", "delete"] as const) {
      const result = describeObjectType(registry, entryFor("dcim.device"), operation);
      expect(result.fields).toEqual([]);
      expect(result.dependsOn).toEqual([]);
      expect(result.notes.length).toBeGreaterThan(0);
    }
    expect(
      describeObjectType(registry, entryFor("dcim.device"), "get").filters,
    ).toBeUndefined();
  });
});

describe("update", () => {
  const update = describeObjectType(registry, entryFor("dcim.device"), "update");

  it("uses the Patched* component and marks every field optional", () => {
    expect(entryFor("dcim.device").patchSchemaName).toBe(
      "PatchedWritableDeviceWithConfigContextRequest",
    );
    expect(update.fields.length).toBeGreaterThan(0);
    expect(update.fields.every((field) => !field.required)).toBe(true);
    expect(update.notes.join(" ")).toContain("partial");
  });

  it("still resolves foreign keys, so dependsOn holds for update too", () => {
    expect(update.dependsOn).toEqual(["dcim.site", "ipam.ipaddress"]);
  });
});
