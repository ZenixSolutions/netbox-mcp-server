/**
 * 9. Plugins.
 *
 * This is the largest unverified area in the whole derivation (§17: "still
 * completely unverified"). The committed fixture is generated from a stock
 * NetBox with no plugins installed, so `/api/plugins/**` appears nowhere in
 * it. Every plugin claim — the four-segment collection rule, the absence of
 * `Brief*`/`Writable*` naming in third-party serializers, the FK reverse
 * index working across plugin boundaries — is untested.
 *
 * Two concrete things this codebase already asserts about plugins and should
 * not:
 *
 *  - `docs/compatibility.md` says netbox-inventory "has tools registered for
 *    it".
 *  - `src/tools/layered/search.ts` hard-codes `plugins/inventory/assets` in
 *    its fixed fan-out list. That endpoint is not derived from anything; if
 *    the plugin's API base is not `inventory`, every global search pays for a
 *    404 on every call.
 *
 * This file reports what the connected instance actually exposes.
 */

import { beforeAll, it } from "vitest";

import type { SchemaRegistry } from "../../src/schema/registry.js";
import { parseJson, preview } from "./http.js";
import { api, derivedRegistry, readPreflightState, record } from "./harness.js";
import { describeContract } from "./expectations.js";

const SECTION = "9. Plugins";

/** Endpoints this codebase names without deriving them. */
const HARD_CODED = ["plugins/inventory/assets"];

describeContract(SECTION, () => {
  let registry: SchemaRegistry;

  beforeAll(async () => {
    registry = await derivedRegistry();
  }, 320_000);

  it("reports which plugins the instance runs", () => {
    const plugins = readPreflightState()?.plugins ?? {};
    const names = Object.entries(plugins).map(([name, version]) => `${name}@${version}`);
    record({
      section: SECTION,
      check: "/api/status/ plugins",
      derived:
        "unknown — the derivation was verified against a stock NetBox with no plugins (§17)",
      actual: names.join(", ") || "no plugins installed",
      verdict: "info",
      note:
        names.length === 0
          ? "This run verifies nothing about plugin support. netbox-inventory remains entirely " +
            "unverified."
          : "The schema paths below are the only evidence about how these plugins are derived.",
    });
  });

  it("reports the plugin paths in the instance's own schema", () => {
    const paths = Object.keys(registry.document.paths ?? {}).filter((path) =>
      path.startsWith("/api/plugins/"),
    );
    record({
      section: SECTION,
      check: "plugin paths in /api/schema/",
      derived:
        "none on stock NetBox; the classifier expects /api/plugins/<plugin>/<slug>/",
      actual:
        paths.length === 0
          ? "none"
          : `${paths.length} path(s): ${paths.slice(0, 20).join(", ")}${paths.length > 20 ? ", …" : ""}`,
      verdict: "info",
    });

    const pluginTypes = [...registry.types.keys()].filter((key) =>
      key.startsWith("plugins."),
    );
    record({
      section: SECTION,
      check: "object types derived under plugins.*",
      derived: "`plugins.<plugin>.<model>` keys, produced by the same rule as core types",
      actual: pluginTypes.join(", ") || "none",
      verdict: "info",
      note:
        paths.length > 0 && pluginTypes.length === 0
          ? "The instance's schema HAS plugin paths but the classifier derived no plugin object " +
            "types from them. That is a derivation bug in classifyPath/objectTypeKey."
          : undefined,
    });
  });

  it("probes the plugin API root and the hard-coded search targets", async () => {
    const root = await api("/plugins/");
    record({
      section: SECTION,
      check: "GET /api/plugins/",
      derived: "unverified",
      actual: `HTTP ${root.status}: ${preview(parseJson(root.body), 200)}`,
      verdict: "info",
    });

    for (const endpoint of HARD_CODED) {
      const result = await api(`/${endpoint}/?limit=1`);
      const derivedKey = [...registry.types.values()].find(
        (entry) => entry.summary.endpoint === endpoint,
      );
      record({
        section: SECTION,
        check: `hard-coded search target /api/${endpoint}/`,
        derived:
          "search.ts fans every netbox_global_search out to this endpoint whether or not the " +
          "plugin is installed",
        actual:
          `HTTP ${result.status}` +
          (result.status === 200
            ? ` — present${derivedKey ? ` and derived as ${derivedKey.summary.object_type}` : ", but NOT in the derived registry"}`
            : " — absent"),
        verdict: "info",
        note:
          result.status === 404
            ? "Every netbox_global_search call on this instance pays a round-trip for a 404 " +
              "here. The target list should come from the registry, not from a constant."
            : derivedKey === undefined && result.status === 200
              ? "The endpoint answers but the registry does not contain it, so netbox_discover " +
                "and netbox_read cannot reach it while netbox_global_search can."
              : undefined,
      });
    }
  });

  it("records how plugin write schemas resolve", () => {
    const pluginEntries = [...registry.types.values()].filter((entry) =>
      entry.summary.object_type.startsWith("plugins."),
    );
    if (pluginEntries.length === 0) {
      record({
        section: SECTION,
        check: "plugin write-schema resolution",
        derived:
          "third-party serializers may not follow the Writable*/Brief* naming the core does",
        actual: "not checked — no plugin object types derived on this instance",
        verdict: "unverified",
      });
      return;
    }
    for (const entry of pluginEntries) {
      record({
        section: SECTION,
        check: `${entry.summary.object_type} schema resolution`,
        derived: "write schema resolved by $ref from the operation, never by name",
        actual:
          `write=${entry.writeSchemaName ?? "none"} (from ${entry.writeSchemaResolvedFrom ?? "nothing"}), ` +
          `patch=${entry.patchSchemaName ?? "none"}, read=${entry.readSchemaName ?? "none"}, ` +
          `ops=[${entry.summary.operations.join(",")}]`,
        verdict: entry.writeSchemaName === undefined ? "mismatch" : "info",
        note:
          entry.writeSchemaName === undefined
            ? "netbox_write cannot describe or validate a create for this plugin type."
            : undefined,
      });
    }
  });
});
