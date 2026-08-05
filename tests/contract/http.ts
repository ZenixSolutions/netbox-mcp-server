/**
 * A small, dependency-free HTTP client for the contract suite.
 *
 * Deliberately NOT the server's own client: the point of this suite is to
 * observe what NetBox actually does, so it must not inherit `src/`'s
 * assumptions — no `validateStatus`, no error mapping, no JSON gating on
 * content-type. Every response is reported exactly as it arrived, including
 * the status, the headers and the byte counts.
 *
 * `node:http`/`node:https` rather than `fetch` for three reasons: arbitrary
 * methods including OPTIONS, per-request TLS relaxation for `NETBOX_INSECURE`,
 * and an honest on-the-wire byte count for the schema-size measurement.
 */

import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

export interface HttpResult {
  method: string;
  url: string;
  status: number;
  statusText: string;
  /** Lower-cased `content-type`, or `""` when the server sent none. */
  contentType: string;
  /** Lower-cased `content-encoding`, or `""`. */
  contentEncoding: string;
  /** Bytes received on the wire, before any decompression. */
  wireBytes: number;
  /** Bytes after decompression — the size of `body`. */
  bytes: number;
  body: string;
  elapsedMs: number;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  insecure?: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 3;

function headerValue(headers: http.IncomingHttpHeaders, name: string): string {
  const raw = headers[name];
  if (typeof raw === "string") return raw.toLowerCase();
  if (Array.isArray(raw) && raw.length > 0) return String(raw[0]).toLowerCase();
  return "";
}

/** Perform one request and report the raw result. Never throws on a status. */
export function request(url: string, options: RequestOptions = {}): Promise<HttpResult> {
  return send(url, options, MAX_REDIRECTS);
}

function send(
  url: string,
  options: RequestOptions,
  redirectsLeft: number,
): Promise<HttpResult> {
  const method = (options.method ?? "GET").toUpperCase();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  return new Promise<HttpResult>((resolve, reject) => {
    const target = new URL(url);
    const headers: Record<string, string> = {
      "Accept-Encoding": "gzip, deflate",
      "User-Agent": "netbox-mcp-contract-suite",
      ...options.headers,
    };
    if (options.body !== undefined) {
      headers["Content-Length"] = String(Buffer.byteLength(options.body));
    }

    const onResponse = (response: http.IncomingMessage): void => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location !== undefined && redirectsLeft > 0) {
        response.resume();
        send(new URL(location, target).toString(), options, redirectsLeft - 1).then(
          resolve,
          reject,
        );
        return;
      }

      const encoding = headerValue(response.headers, "content-encoding");
      let stream: NodeJS.ReadableStream = response;
      if (encoding.includes("gzip")) stream = response.pipe(zlib.createGunzip());
      else if (encoding.includes("deflate")) stream = response.pipe(zlib.createInflate());

      let wireBytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        wireBytes += Buffer.byteLength(chunk);
      });

      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer | string) => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      stream.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          method,
          url,
          status,
          statusText: response.statusMessage ?? "",
          contentType: headerValue(response.headers, "content-type"),
          contentEncoding: encoding,
          wireBytes,
          bytes: buffer.byteLength,
          body: buffer.toString("utf8"),
          elapsedMs: Date.now() - startedAt,
        });
      });
      stream.on("error", reject);
    };

    const requestOptions: https.RequestOptions = { method, headers };
    if (options.insecure === true) requestOptions.rejectUnauthorized = false;

    const clientRequest =
      target.protocol === "http:"
        ? http.request(target, requestOptions, onResponse)
        : https.request(target, requestOptions, onResponse);

    clientRequest.setTimeout(timeoutMs, () => {
      clientRequest.destroy(new Error(`timed out after ${timeoutMs} ms`));
    });
    clientRequest.on("error", reject);
    if (options.body !== undefined) clientRequest.write(options.body);
    clientRequest.end();
  });
}

/* ------------------------------------------------------------------------ */
/* Total accessors over `unknown`.                                           */
/*                                                                            */
/* The lint config makes `any` and every `unsafe-*` rule an error, which is    */
/* correct and also means a contract suite that pokes at untyped JSON needs    */
/* narrowing helpers rather than casts.                                       */
/* ------------------------------------------------------------------------ */

export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A one-line, bounded rendering of any JSON value, for the report. */
export function preview(value: unknown, max = 160): string {
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The `type` of a JSON value as the report talks about it. */
export function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
