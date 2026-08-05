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

  it("distinguishes 403 from 401", () => {
    const forbidden = handleApiError(responseError(403, {}));
    expect(forbidden).toContain("Permission denied");
    expect(forbidden).not.toContain("NETBOX_TOKEN");
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
