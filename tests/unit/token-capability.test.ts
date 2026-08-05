/**
 * Regression tests for the contract suite's token write-capability guard.
 *
 * This guard decides whether `tests/contract/` is allowed to send its two
 * deliberate write requests at a real instance, so it is tested here — in the
 * hermetic `npm test` suite — rather than only in the opt-in live suite that
 * needs credentials.
 *
 * Hermetic: every case runs `probeTokenCapability()` end to end against a
 * loopback `node:http` server serving fixtures, so the real `api()` +
 * `request()` transport and the real parsing are both exercised. Nothing here
 * touches the network.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  actionMethods,
  matchTokenRow,
  mislabelledReadOnlyTokens,
  probeTokenCapability,
  readPreflightState,
  requireReadOnlyToken,
  tokenFingerprint,
  v2TokenIdentifier,
  writePreflightState,
  type TokenCapability,
} from "../contract/harness.js";
import { stateDir, statePath } from "../contract/observations.js";

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                   */
/*                                                                            */
/* Shapes taken from a real NetBox 4.6.7 instance: `key` is the identifier    */
/* segment of `nbt_<identifier>.<secret>`, and OPTIONS returns `actions` as   */
/* an array of method names.                                                  */
/* ------------------------------------------------------------------------ */

/**
 * A NetBox 4.6 token, shaped `nbt_<identifier>.<secret>`; `key` is the
 * 12-character identifier PREFIX, which is the whole point of these tests.
 *
 * FABRICATED. Never put a real token here, even a revoked one: this file is
 * public, and a commit stays reachable by SHA once a pull request has
 * referenced it, so a force-push does not take it back. An earlier revision
 * of this file did exactly that and the secret scan caught it.
 */
const V2_TOKEN = "nbt_EXAMPLEID001.EXAMPLESECRETdoNotUseThisValueItIsFake00";
const V2_KEY = "EXAMPLEID001";

/** Pre-4.6: 40 hex characters, returned whole by ALLOW_TOKEN_RETRIEVAL. */
const LEGACY_TOKEN = "0123456789abcdef0123456789abcdef01234567";

function tokenRow(
  key: string | undefined,
  writeEnabled: boolean,
  description = "",
): Record<string, unknown> {
  return {
    id: 1,
    ...(key === undefined ? {} : { key }),
    write_enabled: writeEnabled,
    description,
  };
}

function tokenList(rows: Record<string, unknown>[]): unknown {
  return { count: rows.length, next: null, previous: null, results: rows };
}

/** The NetBox 4.6 OPTIONS body: `actions` is an ARRAY of method names. */
function netboxOptions(actions: unknown): unknown {
  return {
    name: "Site List",
    description: "",
    renders: ["application/json", "text/html"],
    parses: ["application/json"],
    ...(actions === undefined ? {} : { actions }),
  };
}

/* ------------------------------------------------------------------------ */
/* A loopback NetBox                                                          */
/* ------------------------------------------------------------------------ */

interface Instance {
  tokensStatus?: number;
  tokensBody?: unknown;
  optionsStatus?: number;
  optionsBody?: unknown;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

async function withInstance<T>(
  instance: Instance,
  token: string,
  run: (baseUrl: string) => Promise<T> | T,
): Promise<T> {
  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    const url = request.url ?? "";
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body ?? null));
    };
    if (request.method === "OPTIONS" && url.startsWith("/api/dcim/sites/")) {
      send(instance.optionsStatus ?? 200, instance.optionsBody);
      return;
    }
    if (url.startsWith("/api/users/tokens/")) {
      send(instance.tokensStatus ?? 200, instance.tokensBody);
      return;
    }
    send(404, { detail: "Not found." });
  };

  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  const previousUrl = process.env["NETBOX_URL"];
  const previousToken = process.env["NETBOX_TOKEN"];
  process.env["NETBOX_URL"] = baseUrl;
  process.env["NETBOX_TOKEN"] = token;
  cleanups.push(() => {
    if (previousUrl === undefined) delete process.env["NETBOX_URL"];
    else process.env["NETBOX_URL"] = previousUrl;
    if (previousToken === undefined) delete process.env["NETBOX_TOKEN"];
    else process.env["NETBOX_TOKEN"] = previousToken;
    rmSync(stateDir(baseUrl), { recursive: true, force: true });
  });

  try {
    return await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function probe(instance: Instance, token: string): Promise<TokenCapability> {
  return withInstance(instance, token, () => probeTokenCapability());
}

/* ------------------------------------------------------------------------ */
/* Defect 1 — identifying a NetBox 4.6 "v2" token                             */
/* ------------------------------------------------------------------------ */

describe("v2TokenIdentifier", () => {
  it("returns the segment between nbt_ and the first dot", () => {
    expect(v2TokenIdentifier(V2_TOKEN)).toBe(V2_KEY);
  });

  it("returns undefined for a legacy token, which has no scheme prefix", () => {
    expect(v2TokenIdentifier(LEGACY_TOKEN)).toBeUndefined();
  });

  it("returns undefined for a malformed v2 token", () => {
    expect(v2TokenIdentifier("nbt_nodothere")).toBeUndefined();
    expect(v2TokenIdentifier("nbt_.secret")).toBeUndefined();
  });
});

describe("matchTokenRow", () => {
  it("does not fall back to suffix matching for a v2 token", () => {
    // `y5o5xz` is the tail of the v2 SECRET. A row whose key happens to end
    // that way is not us, and must not be matched.
    const rows = [tokenRow("somethingy5o5xz", true)];
    expect(matchTokenRow(rows, V2_TOKEN).kind).toBe("none");
  });
});

describe("probeTokenCapability — GET /api/users/tokens/", () => {
  it("identifies a v2 token as WRITE-ENABLED from its identifier prefix", async () => {
    const capability = await probe(
      {
        tokensBody: tokenList([
          tokenRow("aaaaaaaaaaaa", true, "someone else"),
          tokenRow(V2_KEY, true, "Read Only Temp Token"),
        ]),
        // Nothing usable here; the token list must carry the determination.
        optionsBody: netboxOptions(undefined),
      },
      V2_TOKEN,
    );

    expect(capability.writeEnabled).toBe(true);
    expect(capability.source).toBe("GET /api/users/tokens/");
    expect(capability.detail).toContain("write_enabled = true");
  });

  it("identifies a v2 token as READ-ONLY from its identifier prefix", async () => {
    const capability = await probe(
      { tokensBody: tokenList([tokenRow(V2_KEY, false, "contract suite")]) },
      V2_TOKEN,
    );

    expect(capability.writeEnabled).toBe(false);
    expect(capability.source).toBe("GET /api/users/tokens/");
  });

  it("still identifies a legacy token by full key equality", async () => {
    const capability = await probe(
      { tokensBody: tokenList([tokenRow(LEGACY_TOKEN, false)]) },
      LEGACY_TOKEN,
    );

    expect(capability.writeEnabled).toBe(false);
    expect(capability.detail).toContain("full key equality");
  });

  it("still identifies a legacy token by the 6-character key suffix", async () => {
    const capability = await probe(
      { tokensBody: tokenList([tokenRow(LEGACY_TOKEN.slice(-6), true)]) },
      LEGACY_TOKEN,
    );

    expect(capability.writeEnabled).toBe(true);
    expect(capability.detail).toContain("legacy 6-character key suffix");
  });

  it("treats two rows that could both be this token as INDETERMINATE", async () => {
    const capability = await probe(
      {
        // Both rows match the identifier. Picking either could report
        // read-only for a token that can write.
        tokensBody: tokenList([
          tokenRow(V2_KEY, true, "first"),
          tokenRow(V2_KEY, false, "second"),
        ]),
        optionsBody: netboxOptions(undefined),
      },
      V2_TOKEN,
    );

    expect(capability.writeEnabled).toBeUndefined();
    expect(capability.source).toBe("indeterminate");
    expect(capability.detail).toContain("2 rows");
    expect(capability.detail).toContain("refusing to guess");
  });

  it("blames ALLOW_TOKEN_RETRIEVAL only when no row carried a key", async () => {
    const capability = await probe(
      {
        tokensBody: tokenList([tokenRow(undefined, true), tokenRow(undefined, true)]),
        optionsBody: netboxOptions(undefined),
      },
      V2_TOKEN,
    );

    expect(capability.writeEnabled).toBeUndefined();
    expect(capability.detail).toContain("ALLOW_TOKEN_RETRIEVAL off");
  });

  it("does not blame ALLOW_TOKEN_RETRIEVAL when keys were returned but none matched", async () => {
    const capability = await probe(
      {
        tokensBody: tokenList([tokenRow("zzzzzzzzzzzz", true)]),
        optionsBody: netboxOptions(undefined),
      },
      V2_TOKEN,
    );

    expect(capability.writeEnabled).toBeUndefined();
    expect(capability.detail).not.toContain("ALLOW_TOKEN_RETRIEVAL");
    expect(capability.detail).toContain("different user");
  });

  it("reports pagination rather than pretending the token is absent", async () => {
    const capability = await probe(
      {
        tokensBody: {
          count: 500,
          next: "…",
          previous: null,
          results: [tokenRow("x", true)],
        },
        optionsBody: netboxOptions(undefined),
      },
      V2_TOKEN,
    );

    expect(capability.detail).toContain("paginated");
  });
});

/* ------------------------------------------------------------------------ */
/* Descriptions that lie                                                      */
/* ------------------------------------------------------------------------ */

describe("mislabelledReadOnlyTokens", () => {
  it("finds writable tokens whose description claims read-only", () => {
    expect(
      mislabelledReadOnlyTokens([
        tokenRow("a", true, "Read Only Temp Token"),
        tokenRow("b", true, "automation"),
        tokenRow("c", false, "read-only, really"),
      ]),
    ).toEqual(["Read Only Temp Token"]);
  });

  it("surfaces the mismatch in the reported detail", async () => {
    const capability = await probe(
      {
        tokensBody: tokenList([
          tokenRow(V2_KEY, true, "Read Only Temp Token"),
          tokenRow("bbbbbbbbbbbb", true, "readonly exports"),
        ]),
      },
      V2_TOKEN,
    );

    expect(capability.detail).toContain("WARNING");
    expect(capability.detail).toContain("2 of 2");
    expect(capability.detail).toContain("Read Only Temp Token");
  });
});

/* ------------------------------------------------------------------------ */
/* Defect 2 — the OPTIONS fallback                                            */
/* ------------------------------------------------------------------------ */

describe("actionMethods", () => {
  it("reads NetBox 4.6's array shape", () => {
    expect(actionMethods(["POST", "PUT"])).toEqual(["POST", "PUT"]);
  });

  it("reads DRF's method-keyed object shape", () => {
    expect(actionMethods({ POST: { name: {} }, PUT: {} })).toEqual(["POST", "PUT"]);
  });

  it("returns undefined when there is no actions value at all", () => {
    expect(actionMethods(undefined)).toBeUndefined();
    expect(actionMethods(null)).toBeUndefined();
  });
});

describe("probeTokenCapability — OPTIONS /api/dcim/sites/", () => {
  it("reads actions.POST from NetBox 4.6's array shape as CAN-WRITE", async () => {
    const capability = await probe(
      {
        // The token list is unusable, exactly as on the live instance where
        // this was found: OPTIONS is the only remaining source.
        tokensStatus: 403,
        tokensBody: { detail: "You do not have permission." },
        optionsBody: netboxOptions(["POST", "PUT"]),
      },
      V2_TOKEN,
    );

    expect(capability.writeEnabled).toBe(true);
    expect(capability.source).toBe("OPTIONS /api/dcim/sites/");
    expect(capability.detail).toContain("POST");
  });

  it("reads actions.POST from DRF's object shape as CAN-WRITE", async () => {
    const capability = await probe(
      {
        tokensStatus: 403,
        optionsBody: netboxOptions({ POST: { name: { type: "string" } } }),
      },
      V2_TOKEN,
    );

    expect(capability.writeEnabled).toBe(true);
    expect(capability.source).toBe("OPTIONS /api/dcim/sites/");
  });

  it("treats an ABSENT actions as no evidence, never as proof of read-only", async () => {
    const capability = await probe(
      { tokensStatus: 403, optionsBody: netboxOptions(undefined) },
      V2_TOKEN,
    );

    expect(capability.writeEnabled).toBeUndefined();
    expect(capability.source).toBe("indeterminate");
    expect(capability.detail).toContain("proves nothing");
  });

  it("treats actions WITHOUT POST as no evidence, never as proof of read-only", async () => {
    const capability = await probe(
      { tokensStatus: 403, optionsBody: netboxOptions(["PUT"]) },
      V2_TOKEN,
    );

    expect(capability.writeEnabled).toBeUndefined();
    expect(capability.detail).toContain("not proof");
  });

  it("never reports read-only from OPTIONS even when the token really is read-only", async () => {
    // The safe direction: a read-only token must be proven by the token list,
    // not inferred from metadata that DRF omits for unrelated reasons.
    const capability = await probe(
      { tokensStatus: 403, optionsBody: netboxOptions([]) },
      V2_TOKEN,
    );
    expect(capability.writeEnabled).not.toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* The gate itself                                                            */
/* ------------------------------------------------------------------------ */

describe("requireReadOnlyToken", () => {
  function seed(baseUrl: string, capability: TokenCapability, token: string): void {
    mkdirSync(stateDir(baseUrl), { recursive: true });
    writePreflightState(baseUrl, {
      capability,
      netboxVersion: "4.6.7",
      plugins: {},
      probedAt: new Date().toISOString(),
      tokenFingerprint: tokenFingerprint(token),
    });
  }

  it("passes only on a positive read-only determination", async () => {
    await withInstance({}, V2_TOKEN, (baseUrl) => {
      seed(
        baseUrl,
        { writeEnabled: false, source: "GET /api/users/tokens/", detail: "ok" },
        V2_TOKEN,
      );
      expect(requireReadOnlyToken()).toContain("GET /api/users/tokens/");
    });
  });

  it("refuses, and no longer blames ALLOW_TOKEN_RETRIEVAL, when indeterminate", async () => {
    await withInstance({}, V2_TOKEN, (baseUrl) => {
      seed(
        baseUrl,
        {
          writeEnabled: undefined,
          source: "indeterminate",
          detail: "no usable evidence",
        },
        V2_TOKEN,
      );
      let message = "";
      try {
        requireReadOnlyToken();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain("Refusing to send any write request");
      // The old guidance told the operator to enable ALLOW_TOKEN_RETRIEVAL as
      // if it were the cause. It is now one listed reason among several, and
      // scoped to the versions where it applies.
      expect(message).toContain("only that user's own tokens");
      expect(message).toContain("its absence is not proof that it cannot");
      expect(message).not.toMatch(/^.*enable\s+ALLOW_TOKEN_RETRIEVAL/m);
    });
  });

  it("refuses to reuse a determination recorded for a different token", async () => {
    await withInstance({}, V2_TOKEN, (baseUrl) => {
      seed(
        baseUrl,
        { writeEnabled: false, source: "GET /api/users/tokens/", detail: "ok" },
        "nbt_someoneelse.secret",
      );
      expect(() => requireReadOnlyToken()).toThrow(/DIFFERENT token/);
    });
  });

  it("degrades to no determination when the state file has no capability", async () => {
    await withInstance({}, V2_TOKEN, (baseUrl) => {
      mkdirSync(stateDir(baseUrl), { recursive: true });
      // A truncated or older-format state file. Blindly casting it produced a
      // TypeError deep inside the gate instead of a legible refusal.
      writeFileSync(
        statePath(baseUrl),
        JSON.stringify({ netboxVersion: "4.6.7" }),
        "utf8",
      );
      expect(readPreflightState()).toBeUndefined();
      expect(() => requireReadOnlyToken()).toThrow(/No preflight state/);
    });
  });
});
