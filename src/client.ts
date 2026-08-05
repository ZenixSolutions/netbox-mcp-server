/**
 * Thin Axios-based NetBox REST client.
 *
 * All tools go through the singleton returned by `getClient()`, which reads
 * config from env at first use and applies the auth header + TLS options.
 */

import axios, { AxiosError, AxiosInstance } from "axios";
import https from "node:https";

import { loadConfig, NetBoxConfig } from "./config.js";
import { DEFAULT_TIMEOUT_MS } from "./constants.js";

let cachedClient: NetBoxClient | null = null;

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export class NetBoxClient {
  readonly config: NetBoxConfig;
  private readonly http: AxiosInstance;

  constructor(config: NetBoxConfig) {
    this.config = config;
    this.http = axios.create({
      baseURL: config.apiUrl,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        Authorization: `Token ${config.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      httpsAgent: config.insecure
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined,
      // Reject only on >= 500 so we can surface NetBox's error body verbatim.
      validateStatus: (status) => status < 500,
    });
  }

  /**
   * GET /<endpoint>/ optionally with query params. `endpoint` should NOT have
   * leading or trailing slashes, e.g. "dcim/sites".
   */
  async list<T>(
    endpoint: string,
    params: Record<string, unknown> = {},
  ): Promise<PaginatedResponse<T>> {
    const response = await this.http.get(`/${endpoint}/`, {
      params: cleanParams(params),
    });
    if (response.status >= 400) {
      throw axiosLikeError(response);
    }
    return response.data as PaginatedResponse<T>;
  }

  /** GET /<endpoint>/<id>/ */
  async get<T>(endpoint: string, id: number | string): Promise<T> {
    const response = await this.http.get(`/${endpoint}/${id}/`);
    if (response.status >= 400) {
      throw axiosLikeError(response);
    }
    return response.data as T;
  }

  /** POST /<endpoint>/ with a JSON body. */
  async create<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.http.post(`/${endpoint}/`, cleanParams(body));
    if (response.status >= 400) {
      throw axiosLikeError(response);
    }
    return response.data as T;
  }

  /** PATCH /<endpoint>/<id>/ with a JSON body. */
  async update<T>(
    endpoint: string,
    id: number | string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.http.patch(`/${endpoint}/${id}/`, cleanParams(body));
    if (response.status >= 400) {
      throw axiosLikeError(response);
    }
    return response.data as T;
  }

  /** DELETE /<endpoint>/<id>/ */
  async del(endpoint: string, id: number | string): Promise<void> {
    const response = await this.http.delete(`/${endpoint}/${id}/`);
    if (response.status >= 400) {
      throw axiosLikeError(response);
    }
  }

  /** GET /<path>/ with raw query params. Used for global search. */
  async raw<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    const response = await this.http.get(path.startsWith("/") ? path : `/${path}`, {
      params: cleanParams(params),
    });
    if (response.status >= 400) {
      throw axiosLikeError(response);
    }
    return response.data as T;
  }
}

/**
 * Drop undefined / null / "" params. Array params with multiple values are
 * preserved so Axios repeats them (e.g. ?tag=foo&tag=bar) — NetBox expects
 * this for multi-value filters.
 */
function cleanParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Shape a 4xx response as an AxiosError-like so `handleApiError` can use the
 * same logic as network errors.
 */
function axiosLikeError(response: { status: number; data: unknown }): Error {
  const err = new axios.AxiosError(
    `Request failed with status code ${response.status}`,
    String(response.status),
  );
  err.response = response as NonNullable<AxiosError["response"]>;
  return err;
}

/** Lazily instantiate the singleton client. */
export function getClient(): NetBoxClient {
  if (!cachedClient) {
    cachedClient = new NetBoxClient(loadConfig());
  }
  return cachedClient;
}

/** Reset the cached client; mainly useful for tests. */
export function resetClient(): void {
  cachedClient = null;
}
