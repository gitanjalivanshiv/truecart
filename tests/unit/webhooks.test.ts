import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertPayPalCertUrl,
  selfVerify,
  signedMessage,
  WebhookVerificationError,
  type WebhookHeaders,
} from "@/src/integrations/paypal/webhooks";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const fetchCert = async () => publicPem;

const rawBody = '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAP-1"}}';
const base = {
  transmissionId: "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  transmissionTime: "2026-11-01T10:00:00Z",
  certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
  authAlgo: "SHA256withRSA",
};

function sign(webhookId: string, body: string): WebhookHeaders {
  const s = createSign("RSA-SHA256");
  s.update(signedMessage(base, webhookId, body));
  return { ...base, transmissionSig: s.sign(privateKey, "base64") };
}

describe("webhook self-verification", () => {
  it("accepts a correctly signed body", async () => {
    const headers = sign("WH-ID-1", rawBody);
    await expect(selfVerify({ headers, webhookId: "WH-ID-1", rawBody, fetchCert })).resolves.toBe(true);
  });

  it("rejects a tampered body", async () => {
    const headers = sign("WH-ID-1", rawBody);
    const tampered = rawBody.replace("CAP-1", "CAP-2");
    await expect(selfVerify({ headers, webhookId: "WH-ID-1", rawBody: tampered, fetchCert })).resolves.toBe(false);
  });

  it("rejects a signature made for another webhook id", async () => {
    const headers = sign("WH-ID-OTHER", rawBody);
    await expect(selfVerify({ headers, webhookId: "WH-ID-1", rawBody, fetchCert })).resolves.toBe(false);
  });

  it.each([
    "http://api.sandbox.paypal.com/cert",
    "https://evil.example/cert",
    "https://paypal.com.evil.example/cert",
    "https://api.sandbox.paypal.com:444/cert",
  ])("refuses cert url %s", (url) => {
    expect(() => assertPayPalCertUrl(url)).toThrow(WebhookVerificationError);
  });
});
