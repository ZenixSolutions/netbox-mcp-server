import { AxiosError } from "axios";
import { describe, expect, it } from "vitest";

import { handleApiError } from "../../src/errors.js";

/**
 * The real client attaches a full request config, which holds the
 * Authorization header. Reproduce that so the redaction tests are honest —
 * without it they would pass against an error that never carried a token.
 */
const CONFIG_WITH_TOKEN = {
  headers: { Authorization: "Token s3cr3t-token" },
} as unknown as NonNullable<AxiosError["config"]>;

function responseError(status: number, data: unknown): AxiosError {
  const err = new AxiosError(`Request failed with status code ${status}`, String(status));
  return Object.assign(err, {
    config: CONFIG_WITH_TOKEN,
    response: { status, data } as NonNullable<AxiosError["response"]>,
  });
}

function networkError(code: string): AxiosError {
  return Object.assign(new AxiosError("network", code), { config: CONFIG_WITH_TOKEN });
}

describe("handleApiError", () => {
  it("never includes the Authorization header", () => {
    const cases = [
      responseError(400, { name: ["This field is required."] }),
      responseError(401, { detail: "Invalid token." }),
      responseError(500, "upstream exploded"),
      networkError("ECONNREFUSED"),
    ];
    for (const err of cases) {
      expect(handleApiError(err)).not.toContain("s3cr3t-token");
    }
  });

  it("extracts DRF field errors", () => {
    const message = handleApiError(
      responseError(400, { name: ["This field is required."], slug: ["Invalid."] }),
    );
    expect(message).toContain("name: This field is required.");
    expect(message).toContain("slug: Invalid.");
  });

  it("prefers `detail` when present", () => {
    expect(handleApiError(responseError(404, { detail: "Not found." }))).toContain(
      "Not found.",
    );
  });

  it("names the environment variable to fix on 401", () => {
    expect(handleApiError(responseError(401, {}))).toContain("NETBOX_TOKEN");
  });

  it("still names a permission failure as one", () => {
    const forbidden = handleApiError(
      responseError(403, {
        detail: "You do not have permission to perform this action.",
      }),
    );
    expect(forbidden).toContain("Permission denied");
    expect(forbidden).toContain("write_enabled");
    expect(forbidden).not.toContain("NETBOX_TOKEN");
  });

  /**
   * A live NetBox 4.6.0 answers 403, NOT 401, for a token it cannot use:
   * `{"detail":"Invalid v2 token"}`. The 403 branch used to say "the API token
   * lacks permission for this object or action", which sends an operator with
   * a wrong token to audit object permissions.
   */
  describe("403 says which of the two causes it is", () => {
    it("reads an invalid token as an invalid token, not a permission problem", () => {
      const message = handleApiError(responseError(403, { detail: "Invalid v2 token" }));
      expect(message).toContain("NETBOX_TOKEN");
      expect(message).toContain("Invalid v2 token");
      expect(message).not.toMatch(/lacks permission for this object/i);
      expect(message).not.toMatch(/object permissions/i);
    });

    it("recognises an expired token", () => {
      expect(
        handleApiError(responseError(403, { detail: "Token has expired." })),
      ).toContain("NETBOX_TOKEN");
    });

    it("names a stripped Authorization header for the unauthenticated case", () => {
      // The server always sends a token, so this body means the header never
      // arrived — a proxy ate it. It is neither a network error nor a
      // permission problem, and looks like both.
      const message = handleApiError(
        responseError(403, { detail: "Authentication credentials were not provided." }),
      );
      expect(message).toMatch(/no credential/i);
      expect(message).toMatch(/proxy/i);
      expect(message).toMatch(/header/i);
      expect(message).not.toMatch(/lacks permission for this object/i);
    });

    it("offers both causes when the body does not say which", () => {
      for (const body of [{}, { detail: "Forbidden." }, "something unfamiliar"]) {
        const message = handleApiError(responseError(403, body));
        expect(message).toContain("NETBOX_TOKEN");
        expect(message).toMatch(/permitted|permission/i);
        expect(message).toMatch(/two are possible/i);
      }
    });
  });

  /**
   * A live 404 on an unknown endpoint answers `text/html`. Axios hands the
   * page through as `response.data`, and it used to be relayed verbatim.
   */
  describe("an upstream body is bounded before it reaches the model", () => {
    const page =
      "<!DOCTYPE html>\n<html><head><title>Page not found</title></head>" +
      `<body><h1>Not Found</h1><p>${"x".repeat(5000)}</p></body></html>`;

    it("describes an HTML error page instead of relaying it", () => {
      const message = handleApiError(responseError(404, page));
      expect(message).not.toContain("<html");
      expect(message).not.toContain("<h1>");
      expect(message).toMatch(/HTML page/i);
      expect(message.length).toBeLessThan(500);
    });

    it("describes HTML that arrived inside a `detail` string too", () => {
      const message = handleApiError(responseError(500, { detail: page }));
      expect(message).not.toContain("<html");
      expect(message).toMatch(/HTML page/i);
    });

    it("truncates a long plain-text body rather than relaying all of it", () => {
      const message = handleApiError(
        responseError(500, "upstream said: " + "y".repeat(5000)),
      );
      expect(message).toContain("upstream said:");
      expect(message).toContain("truncated");
      expect(message.length).toBeLessThan(600);
    });

    it("truncates long field errors as well", () => {
      const message = handleApiError(
        responseError(400, { name: ["z".repeat(2000)], slug: ["also too long"] }),
      );
      expect(message.length).toBeLessThan(600);
    });

    it("leaves a short body exactly as NetBox wrote it", () => {
      expect(handleApiError(responseError(404, { detail: "Not found." }))).toContain(
        "Not found.",
      );
    });
  });

  it("maps network failures to actionable messages", () => {
    expect(handleApiError(networkError("ECONNABORTED"))).toMatch(/timed out/i);
    expect(handleApiError(networkError("ENOTFOUND"))).toMatch(/NETBOX_URL/);
    expect(handleApiError(networkError("ECONNREFUSED"))).toMatch(/refused/i);
    expect(handleApiError(networkError("CERT_HAS_EXPIRED"))).toMatch(/NETBOX_INSECURE/);
  });

  it("handles non-Axios values without throwing", () => {
    expect(handleApiError(new Error("boom"))).toBe("Error: boom");
    expect(handleApiError("boom")).toBe("Error: boom");
    expect(handleApiError(undefined)).toContain("undefined");
  });
});
