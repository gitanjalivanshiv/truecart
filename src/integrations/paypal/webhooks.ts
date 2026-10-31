// PayPal webhook signature verification.
// Primary: self-verification (docs: developer.paypal.com/api/rest/webhooks/rest/) —
//   sig = SHA256withRSA over `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(rawBody)}`
//   checked against the certificate at paypal-cert-url (host allowlisted, cached).
// Fallback: postback to POST /v1/notifications/verify-webhook-signature (not supported for simulator mock events).

import { createPublicKey, createVerify, X509Certificate } from "node:crypto";
import { crc32 } from "node:zlib";
import { paypalRequest } from "./client";

export interface WebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
}

export class WebhookVerificationError extends Error {
  override name = "WebhookVerificationError";
}

export function readWebhookHeaders(get: (name: string) => string | null | undefined): WebhookHeaders {
  const pick = (name: string) => {
    const v = get(name);
    if (!v) throw new WebhookVerificationError(`missing header ${name}`);
    return v;
  };
  return {
    transmissionId: pick("paypal-transmission-id"),
    transmissionTime: pick("paypal-transmission-time"),
    transmissionSig: pick("paypal-transmission-sig"),
    certUrl: pick("paypal-cert-url"),
    authAlgo: get("paypal-auth-algo") ?? "SHA256withRSA",
  };
}

/** Only fetch signing certs from PayPal over HTTPS. Prevents an attacker pointing us at their own cert. */
export function assertPayPalCertUrl(certUrl: string): URL {
  let url: URL;
  try {
    url = new URL(certUrl);
  } catch {
    throw new WebhookVerificationError("cert url is not a URL");
  }
  const hostOk = url.hostname === "paypal.com" || url.hostname.endsWith(".paypal.com");
  if (url.protocol !== "https:" || !hostOk || url.port !== "" || url.username || url.password) {
    throw new WebhookVerificationError("cert url is not an https PayPal host");
  }
  return url;
}

export function signedMessage(
  h: Pick<WebhookHeaders, "transmissionId" | "transmissionTime">,
  webhookId: string,
  rawBody: Buffer | string,
): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  return `${h.transmissionId}|${h.transmissionTime}|${webhookId}|${crc32(body)}`;
}

export type CertFetcher = (url: URL) => Promise<string>;

const certCache = new Map<string, string>();

export const fetchCertPem: CertFetcher = async (url) => {
  const hit = certCache.get(url.href);
  if (hit) return hit;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) throw new WebhookVerificationError(`cert fetch failed: ${res.status}`);
  const pem = await res.text();
  const cert = new X509Certificate(pem);
  if (new Date(cert.validTo).getTime() < Date.now()) throw new WebhookVerificationError("signing cert expired");
  certCache.set(url.href, pem);
  return pem;
};

export async function selfVerify(opts: {
  headers: WebhookHeaders;
  webhookId: string;
  rawBody: Buffer | string;
  fetchCert?: CertFetcher;
}): Promise<boolean> {
  const { headers, webhookId, rawBody, fetchCert = fetchCertPem } = opts;
  if (headers.authAlgo !== "SHA256withRSA")
    throw new WebhookVerificationError(`unsupported auth algo ${headers.authAlgo}`);
  const pem = await fetchCert(assertPayPalCertUrl(headers.certUrl));
  const key = createPublicKey(pem); // accepts an X.509 certificate or a public key PEM
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signedMessage(headers, webhookId, rawBody));
  return verifier.verify(key, headers.transmissionSig, "base64");
}

/** Postback verification. `rawBody` is sent back byte-for-byte as PayPal warns re-serializing can fail. */
export async function postbackVerify(opts: {
  headers: WebhookHeaders;
  webhookId: string;
  rawBody: string;
}): Promise<string> {
  const { headers, webhookId, rawBody } = opts;
  const body =
    `{"auth_algo":${JSON.stringify(headers.authAlgo)},"cert_url":${JSON.stringify(headers.certUrl)},` +
    `"transmission_id":${JSON.stringify(headers.transmissionId)},"transmission_sig":${JSON.stringify(headers.transmissionSig)},` +
    `"transmission_time":${JSON.stringify(headers.transmissionTime)},"webhook_id":${JSON.stringify(webhookId)},` +
    `"webhook_event":${rawBody}}`;
  const { data } = await paypalRequest<{ verification_status?: string }>({
    method: "POST",
    path: "/v1/notifications/verify-webhook-signature",
    body: JSON.parse(body),
    requestId: `verify-${headers.transmissionId}`,
  });
  return data.verification_status ?? "UNKNOWN";
}
