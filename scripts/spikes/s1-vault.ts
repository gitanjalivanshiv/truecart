// S1 — Vault v3 without purchase + merchant-initiated charge with the vaulted token.
// Docs: developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/
//       developer.paypal.com/api/orders/v2/definitions/payment_source (paypal.stored_credential)
//
//   npm run spike:vault -- setup [--pattern UNSCHEDULED_PREPAID]  -> prints approve URL (open it, log in as the GB sandbox buyer)
//   npm run spike:vault -- status                                   -> setup token status (expect APPROVED)
//   npm run spike:vault -- token                                    -> exchanges setup token for a payment token (vault id)
//   npm run spike:vault -- charge [--currency USD] [--amount 12.34] [--no-stored-credential]
//   npm run spike:vault -- replay                                   -> re-sends last charge's PayPal-Request-Id (idempotency check)

import { randomUUID } from "node:crypto";
import { paypalRequest } from "@/src/integrations/paypal/client";
import { arg, load, requireEnv, run, save, show } from "./_lib";
import { chargeVaulted } from "./_orders";

type Link = { rel: string; href: string };
type SetupToken = { id: string; status: string; links?: Link[] };
type PaymentToken = { id: string; customer?: { id?: string }; payment_source?: unknown };
type State = {
  setupTokenId?: string;
  usagePattern?: string;
  vaultId?: string;
  customerId?: string;
  lastCharge?: { requestId: string; currency: string; amount: string };
};

const STATE = "s1-vault";

run(async () => {
  requireEnv("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET");
  const cmd = process.argv[2] ?? "setup";
  const state = load<State>(STATE) ?? {};

  if (cmd === "setup") {
    const usagePattern = arg("pattern", "UNSCHEDULED_PREPAID")!;
    const returnUrl = `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/spike/vault-return`;
    const { data } = await paypalRequest<SetupToken>({
      method: "POST",
      path: "/v3/vault/setup-tokens",
      requestId: `spike-setup-${randomUUID()}`,
      body: {
        payment_source: {
          paypal: {
            description: "TrueCart shopping mandate (sandbox, no real money)",
            usage_pattern: usagePattern,
            usage_type: "MERCHANT",
            customer_type: "CONSUMER",
            permit_multiple_payment_tokens: false,
            experience_context: {
              brand_name: "TrueCart (sandbox)",
              locale: "en-GB",
              return_url: returnUrl,
              cancel_url: returnUrl,
            },
          },
        },
      },
    });
    save(STATE, { ...state, setupTokenId: data.id, usagePattern, vaultId: undefined });
    show("setup token", { id: data.id, status: data.status, usagePattern });
    const approve = data.links?.find((l) => l.rel === "approve")?.href;
    // The approve link is printed to the terminal only (never written to docs).
    console.log(
      `\nOpen this URL and approve as the GB sandbox buyer, then run: npm run spike:vault -- token\n${approve}`,
    );
    return;
  }

  if (cmd === "status") {
    if (!state.setupTokenId) throw new Error("run setup first");
    const { data } = await paypalRequest<SetupToken>({
      method: "GET",
      path: `/v3/vault/setup-tokens/${state.setupTokenId}`,
    });
    show("setup token status", { id: data.id, status: data.status });
    return;
  }

  if (cmd === "token") {
    if (!state.setupTokenId) throw new Error("run setup first");
    const { data } = await paypalRequest<PaymentToken>({
      method: "POST",
      path: "/v3/vault/payment-tokens",
      requestId: `spike-ptoken-${state.setupTokenId}`,
      body: { payment_source: { token: { id: state.setupTokenId, type: "SETUP_TOKEN" } } },
    });
    save(STATE, { ...state, vaultId: data.id, customerId: data.customer?.id });
    show("payment token", { vault_id: data.id, customer_id: data.customer?.id, payment_source: data.payment_source });
    return;
  }

  if (cmd === "charge" || cmd === "replay") {
    if (!state.vaultId) throw new Error("run token first");
    const currency = cmd === "replay" ? state.lastCharge!.currency : arg("currency", "USD")!;
    const amount = cmd === "replay" ? state.lastCharge!.amount : arg("amount", "12.34")!;
    const requestId = cmd === "replay" ? state.lastCharge!.requestId : undefined;
    const t0 = Date.now();
    const { summary } = await chargeVaulted({
      vaultId: state.vaultId,
      currency,
      value: amount,
      usagePattern: state.usagePattern,
      storedCredential: !process.argv.includes("--no-stored-credential"),
      requestId,
      merchantLabel: "SPIKE-S1",
    });
    save(STATE, { ...state, lastCharge: { requestId: summary.requestId, currency, amount } });
    show(`${cmd} result (${Date.now() - t0}ms, no redirect)`, summary);
    if (summary.approveLink)
      console.log("\nNOTE: PayPal returned a payer-action link -> merchant-initiated charge NOT achieved.");
    return;
  }

  throw new Error(`unknown command ${cmd}`);
});
