// PayPal REST client. Plain fetch, sandbox only, every call has a timeout and typed errors.
// Server-side only: reads the client secret from the environment and never logs it.

import { paypalBaseUrl } from "@/src/config/sandbox";
import { redact } from "@/src/lib/redact";

const DEFAULT_TIMEOUT_MS = 15_000;

export class PayPalConfigError extends Error {
  override name = "PayPalConfigError";
}

export class PayPalTimeoutError extends Error {
  override name = "PayPalTimeoutError";
  constructor(
    readonly method: string,
    readonly path: string,
    readonly timeoutMs: number,
  ) {
    super(`PayPal ${method} ${path} timed out after ${timeoutMs}ms`);
  }
}

export class PayPalApiError extends Error {
  override name = "PayPalApiError";
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly debugId: string | undefined,
    readonly issue: string | undefined,
    readonly body: unknown,
  ) {
    super(`PayPal ${status} on ${method} ${path}${issue ? ` (${issue})` : ""}${debugId ? ` debug_id=${debugId}` : ""}`);
  }
}

export interface AccessToken {
  token: string;
  scopes: string[];
  expiresInSeconds: number;
  appId?: string;
}

let cached: { value: AccessToken; expiresAt: number } | undefined;

function credentials(env: NodeJS.ProcessEnv = process.env) {
  const id = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret)
    throw new PayPalConfigError("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (see .env.example)");
  return { id, secret };
}

export async function getAccessToken({ force = false } = {}): Promise<AccessToken> {
  if (!force && cached && Date.now() < cached.expiresAt) return cached.value;

  const { id, secret } = credentials();
  const path = "/v1/oauth2/token";
  const res = await timedFetch("POST", path, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw await apiError(res, "POST", path);

  const json = (await res.json()) as { access_token: string; scope?: string; expires_in: number; app_id?: string };
  const value: AccessToken = {
    token: json.access_token,
    scopes: (json.scope ?? "").split(" ").filter(Boolean),
    expiresInSeconds: json.expires_in,
    appId: json.app_id,
  };
  // Refresh a minute early so an in-flight request never carries an expired token.
  cached = { value, expiresAt: Date.now() + Math.max(0, json.expires_in - 60) * 1000 };
  return value;
}

export interface PayPalRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  /** Required for every write: PayPal-Request-Id makes retries idempotent. */
  requestId?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function paypalRequest<T = unknown>(
  req: PayPalRequest,
): Promise<{ status: number; data: T; debugId?: string }> {
  if (req.method !== "GET" && !req.requestId) {
    throw new PayPalConfigError(`PayPal ${req.method} ${req.path} needs a requestId (PayPal-Request-Id)`);
  }
  for (let attempt = 1; ; attempt++) {
    const { token } = await getAccessToken();
    const res = await timedFetch(
      req.method,
      req.path,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...(req.requestId ? { "PayPal-Request-Id": req.requestId } : {}),
          ...req.headers,
        },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      },
      req.timeoutMs,
    );

    // Expired or revoked token: mint a new one once.
    if (res.status === 401 && attempt === 1) {
      cached = undefined;
      continue;
    }
    if (!res.ok) throw await apiError(res, req.method, req.path);
    const text = await res.text();
    return {
      status: res.status,
      data: (text ? JSON.parse(text) : {}) as T,
      debugId: res.headers.get("paypal-debug-id") ?? undefined,
    };
  }
}

async function timedFetch(method: string, path: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = `${paypalBaseUrl()}${path}`;
  try {
    return await fetch(url, { ...init, method, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") throw new PayPalTimeoutError(method, path, timeoutMs);
    throw err;
  }
}

async function apiError(res: Response, method: string, path: string): Promise<PayPalApiError> {
  const text = await res.text();
  let body: unknown = text.slice(0, 2000);
  let issue: string | undefined;
  try {
    const json = JSON.parse(text) as { name?: string; error?: string; details?: { issue?: string }[] };
    body = redact(json);
    issue = json.details?.[0]?.issue ?? json.name ?? json.error;
  } catch {
    /* non-JSON body: keep the truncated text */
  }
  return new PayPalApiError(res.status, method, path, res.headers.get("paypal-debug-id") ?? undefined, issue, body);
}
