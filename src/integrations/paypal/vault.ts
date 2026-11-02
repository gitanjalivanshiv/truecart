// Vault v3 wallet linking (flow verified live in spike S1): setup token -> buyer approves at PayPal ->
// payment token (= vault id). usage_pattern must match what the executor sends with each charge.

import { randomUUID } from "node:crypto";
import { VAULT_USAGE_PATTERN } from "@/src/executor/gateway";
import { paypalRequest } from "./client";

type Link = { rel: string; href: string };

export async function createSetupToken(
  returnUrl: string,
  cancelUrl: string,
): Promise<{ id: string; approveUrl: string }> {
  const { data } = await paypalRequest<{ id: string; status: string; links?: Link[] }>({
    method: "POST",
    path: "/v3/vault/setup-tokens",
    requestId: `setup-${randomUUID()}`,
    body: {
      payment_source: {
        paypal: {
          description: "TrueCart shopping mandate (sandbox, no real money)",
          usage_pattern: VAULT_USAGE_PATTERN,
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          permit_multiple_payment_tokens: false,
          experience_context: {
            brand_name: "TrueCart (sandbox)",
            locale: "en-GB",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    },
  });
  const approveUrl = data.links?.find((l) => l.rel === "approve")?.href;
  if (!approveUrl) throw new Error("PayPal did not return an approval link");
  return { id: data.id, approveUrl };
}

export async function setupTokenStatus(id: string): Promise<string> {
  const { data } = await paypalRequest<{ status: string }>({
    method: "GET",
    path: `/v3/vault/setup-tokens/${encodeURIComponent(id)}`,
  });
  return data.status;
}

export async function exchangeForPaymentToken(setupTokenId: string): Promise<string> {
  const { data } = await paypalRequest<{ id: string }>({
    method: "POST",
    path: "/v3/vault/payment-tokens",
    requestId: `ptoken-${setupTokenId}`,
    body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
  });
  return data.id;
}
