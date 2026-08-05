/**
 * 7. Error contract, and 8. write paths.
 *
 * `src/errors.ts` switches on the status code and produces a different piece
 * of advice for each. That advice is only useful if the codes are what it
 * thinks. In particular it maps 401 to "check that NETBOX_TOKEN is valid and
 * not expired" — which is exactly the wrong thing to tell someone whose token
 * is valid but read-only, and a sibling server found precisely that confusion
 * on a live instance.
 *
 * ## Why the write probes are safe
 *
 * Three independent guards, any one of which is sufficient:
 *
 *  1. `global-setup.ts` establishes the token cannot write and ABORTS the
 *     whole run before this file is loaded if it can.
 *  2. `requireReadOnlyToken()` throws here unless that determination was
 *     positive, so an indeterminate probe skips the write tests rather than
 *     guessing.
 *  3. The requests themselves cannot mutate anything even against a
 *     read-write token: the create sends an EMPTY body to an endpoint whose
 *     write schema has required fields (DRF answers 400 and creates nothing),
 *     and the delete targets an id that does not exist (DRF answers 404 and
 *     deletes nothing). DRF runs `check_permissions` in `initial()`, before
 *     both body validation and `get_object()`, so a read-only token is refused
 *     ahead of either.
 *
 * Nothing in this file may be changed to send a well-formed body or a real id.
 */

import { AxiosError } from "axios";
import { beforeAll, it } from "vitest";

import { handleApiError } from "../../src/errors.js";
import type { SchemaRegistry } from "../../src/schema/registry.js";
import { asRecord, parseJson, preview } from "./http.js";
import { api, derivedRegistry, env, record, requireReadOnlyToken } from "./harness.js";
import { check, describeContract } from "./expectations.js";

const SECTION = "7. Error contract";
const SECTION_WRITE = "8. Write refusal";

/** Below int32 max, so NetBox answers 404 rather than 500 on overflow. */
const NONEXISTENT_ID = 2_147_483_600;

const REFUSED = [401, 403];

/**
 * Feed a real response into the shipped formatter exactly as the client would,
 * so the report shows what an operator would actually be told — not what the
 * status code suggests they would be told.
 */
function asAxiosError(status: number, data: unknown): AxiosError {
  const error = new AxiosError(
    `Request failed with status code ${status}`,
    String(status),
  );
  return Object.assign(error, {
    response: { status, data } as NonNullable<AxiosError["response"]>,
  });
}

function bodyShape(body: string): string {
  const parsed = asRecord(parseJson(body));
  if (!parsed) return `non-object body: ${preview(parseJson(body), 100)}`;
  const keys = Object.keys(parsed);
  return `{${keys.join(", ")}} — ${preview(parsed, 140)}`;
}

describeContract(`${SECTION} + ${SECTION_WRITE}`, () => {
  let registry: SchemaRegistry;
  /** A collection whose create schema has required fields. */
  let writeProbeEndpoint = "dcim/sites";

  beforeAll(async () => {
    registry = await derivedRegistry();
    if (!registry.types.has("dcim.site")) {
      for (const entry of registry.types.values()) {
        if (entry.summary.operations.includes("create")) {
          writeProbeEndpoint = entry.summary.endpoint;
          break;
        }
      }
    }
  }, 320_000);

  it("rejects an invalid token with a status and body errors.ts can read", async () => {
    // Appending a character to a valid token yields a token of the wrong
    // length. It cannot collide with a real one.
    const result = await api("/status/", { token: `${env().token}0` });
    // 4.6.0 answers 403 with {"detail":"Invalid v2 token"}, not 401. errors.ts
    // now reads the `detail` rather than the status, so either status is
    // handled — but only if the body says which cause it is.
    const message = handleApiError(asAxiosError(result.status, parseJson(result.body)));
    const namesTheToken = /NETBOX_TOKEN/.test(message);
    const blamesPermissions = /object permissions|lacks permission for this object/i.test(
      message,
    );
    check({
      section: SECTION,
      check: "invalid token",
      derived:
        "401, or 403 whose body names the credential — errors.ts must send the operator to " +
        "NETBOX_TOKEN and must NOT send them to audit object permissions",
      actual:
        `HTTP ${result.status} ${result.statusText}; body ${bodyShape(result.body)}; ` +
        `errors.ts says: ${preview(message, 200)}`,
      verdict: namesTheToken && !blamesPermissions ? "match" : "mismatch",
      note:
        namesTheToken && !blamesPermissions
          ? undefined
          : `errors.ts does not recognise this instance's ${result.status} body as a credential ` +
            "failure, so the operator is told something other than 'your token is wrong'. Add " +
            "the wording to BAD_CREDENTIAL in src/errors.ts.",
    });
  });

  it("records what an unauthenticated request returns", async () => {
    const result = await api("/status/", { anonymous: true });
    record({
      section: SECTION,
      check: "no Authorization header",
      derived:
        "403 was observed on demo.netbox.dev (derivation §1.1); DRF would normally answer 401",
      actual:
        `HTTP ${result.status} ${result.statusText}; body ${bodyShape(result.body)}; ` +
        `errors.ts says: ${preview(handleApiError(asAxiosError(result.status, parseJson(result.body))), 200)}`,
      verdict: "info",
      note:
        "The server always sends a token, so this only matters for diagnosing a proxy that " +
        "strips the header — which presents as this status, not as a network error. errors.ts " +
        "names that case explicitly; check above that it did.",
    });

    const root = await api("/", { anonymous: true });
    record({
      section: SECTION,
      check: "unauthenticated GET /api/",
      derived:
        "403 when LOGIN_REQUIRED is on; 200 when it is off (derivation §1.1). Records whether " +
        "this instance gates the API at all.",
      actual: `HTTP ${root.status} ${root.statusText}`,
      verdict: "info",
      note:
        "The server always authenticates, so this is diagnostic only — it is the difference " +
        "between 'the token was rejected' and 'the header never arrived'.",
    });
  });

  it("returns 404 for an object that does not exist", async () => {
    const result = await api(`/${writeProbeEndpoint}/${NONEXISTENT_ID}/`);
    check({
      section: SECTION,
      check: "GET a nonexistent object id",
      derived: "404 — errors.ts: 'NetBox object not found (404)'",
      actual: `HTTP ${result.status}; body ${bodyShape(result.body)}`,
      verdict: result.status === 404 ? "match" : "mismatch",
    });

    const parsed = asRecord(parseJson(result.body));
    record({
      section: SECTION,
      check: "error body carries a `detail` string",
      derived:
        "extractNetBoxMessage reads `detail` first, then field->array pairs, then plain strings",
      actual:
        typeof parsed?.["detail"] === "string"
          ? `detail = ${preview(parsed["detail"], 80)}`
          : `no string \`detail\`; keys: ${Object.keys(parsed ?? {}).join(", ") || "none"}`,
      verdict: typeof parsed?.["detail"] === "string" ? "match" : "mismatch",
      note:
        typeof parsed?.["detail"] === "string"
          ? undefined
          : "handleApiError falls through to a generic message and the model loses NetBox's " +
            "own explanation.",
    });
  });

  it("returns 404 for an endpoint that does not exist", async () => {
    const result = await api("/nb-mcp-contract/no-such-collection/");
    record({
      section: SECTION,
      check: "GET an endpoint that does not exist",
      derived:
        "404 — this is the status a derivation bug produces, so it must be distinguishable",
      actual: `HTTP ${result.status}; content-type ${result.contentType || "none"}`,
      verdict: result.status === 404 ? "match" : "info",
      note: result.contentType.includes("html")
        ? "NetBox answered with HTML, not JSON — an error page, not an error body."
        : undefined,
    });

    // The body an HTML 404 produces is exactly what must NOT reach a model.
    // extractNetBoxMessage bounds it; this is the live proof, on this
    // instance's real error page rather than a fabricated one.
    const message = handleApiError(asAxiosError(result.status, result.body));
    const relaysMarkup = /<\/?(?:html|head|body|h1|div|script)\b/i.test(message);
    check({
      section: SECTION,
      check: "the 404 body errors.ts would relay is bounded",
      derived:
        "no markup and at most a few hundred characters, however large the page NetBox served",
      actual:
        `page was ${result.bytes} byte(s); errors.ts produced ${message.length} character(s): ` +
        preview(message, 200),
      verdict: !relaysMarkup && message.length < 1_000 ? "match" : "mismatch",
      note: relaysMarkup
        ? "An upstream error page is reaching the model verbatim. Bound it in errors.ts."
        : undefined,
    });
  });

  it("refuses a create with a read-only token", async () => {
    let capability: string;
    try {
      capability = requireReadOnlyToken();
    } catch (error) {
      record({
        section: SECTION_WRITE,
        check: "POST refused",
        derived: "403 from NetBox's TokenPermissions when write_enabled is false",
        actual: `not attempted — ${error instanceof Error ? error.message : String(error)}`,
        verdict: "unverified",
      });
      return;
    }

    // EMPTY body, deliberately. Even against a read-write token this creates
    // nothing: the write schema has required fields and DRF answers 400.
    const result = await api(`/${writeProbeEndpoint}/`, {
      method: "POST",
      body: "{}",
    });

    check({
      section: SECTION_WRITE,
      check: `POST /api/${writeProbeEndpoint}/ with a read-only token`,
      derived:
        "403 — NetBox's TokenPermissions denies unsafe methods when write_enabled is false, " +
        "and errors.ts reads the body: a permission wording produces 'permission denied', " +
        "naming write_enabled as the commonest cause",
      actual:
        `HTTP ${result.status} ${result.statusText}; body ${bodyShape(result.body)}; ` +
        `errors.ts says: ${preview(handleApiError(asAxiosError(result.status, parseJson(result.body))), 200)}`,
      verdict: REFUSED.includes(result.status)
        ? result.status === 403
          ? "match"
          : "info"
        : "mismatch",
      note:
        result.status === 403
          ? `Token capability established by ${capability}.`
          : result.status === 401
            ? "401, not 403. errors.ts tells the operator their token is invalid or expired. " +
              "It is neither — it is read-only. That message sends them to the wrong fix."
            : "The write was NOT refused with an auth status. Stop and investigate before " +
              "running this suite again.",
    });
  });

  it("refuses a delete with a read-only token", async () => {
    let capability: string;
    try {
      capability = requireReadOnlyToken();
    } catch (error) {
      record({
        section: SECTION_WRITE,
        check: "DELETE refused",
        derived: "403 from NetBox's TokenPermissions when write_enabled is false",
        actual: `not attempted — ${error instanceof Error ? error.message : String(error)}`,
        verdict: "unverified",
      });
      return;
    }

    // A nonexistent id, deliberately. DRF checks permissions in `initial()`,
    // before `get_object()`, so a read-only token is refused; a write-enabled
    // token would get 404 and delete nothing.
    const result = await api(`/${writeProbeEndpoint}/${NONEXISTENT_ID}/`, {
      method: "DELETE",
    });

    check({
      section: SECTION_WRITE,
      check: `DELETE /api/${writeProbeEndpoint}/${NONEXISTENT_ID}/ with a read-only token`,
      derived: "403, refused on permission before the object is looked up",
      actual: `HTTP ${result.status} ${result.statusText}; body ${bodyShape(result.body)}`,
      verdict: REFUSED.includes(result.status)
        ? result.status === 403
          ? "match"
          : "info"
        : "mismatch",
      note:
        result.status === 404
          ? "404, not 403: this instance looks the object up BEFORE checking write permission. " +
            "That leaks object existence to a read-only token, and it means netbox_write's " +
            "delete path reports 'not found' where it should report 'not permitted'."
          : result.status === 403
            ? `Token capability established by ${capability}.`
            : undefined,
    });
  });
});
