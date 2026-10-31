// S3 — PayPal Currency Exchange quote API access (expected gated) + public-rate fallback.
// Docs: developer.paypal.com/api/pricing/v2/quote-exchange-rates
//   scope required: https://uri.paypal.com/services/pricing/quote-exchange-rates/read

import { randomUUID } from "node:crypto";
import { getAccessToken, paypalRequest } from "@/src/integrations/paypal/client";
import { frankfurter } from "@/src/integrations/fxrates/frankfurter";
import { run, save, show } from "./_lib";

const FX_SCOPE = "https://uri.paypal.com/services/pricing/quote-exchange-rates/read";

run(async () => {
  const result: Record<string, unknown> = {};

  const t0 = Date.now();
  result.fallback = {
    source: "frankfurter",
    quotes: await frankfurter.quote("GBP", ["USD", "EUR"]),
    ms: Date.now() - t0,
  };

  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    result.paypal = "BLOCKED: missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET";
  } else {
    const token = await getAccessToken({ force: true });
    result.tokenHasFxScope = token.scopes.includes(FX_SCOPE);
    result.scopeCount = token.scopes.length;
    try {
      const { data } = await paypalRequest({
        method: "POST",
        path: "/v2/pricing/quote-exchange-rates",
        requestId: `spike-fx-${randomUUID()}`,
        body: {
          quote_items: [
            { base_currency: "USD", base_amount: "100.00", quote_currency: "GBP" },
            { base_currency: "USD", base_amount: "100.00", quote_currency: "EUR" },
          ],
        },
      });
      result.paypal = { ok: true, data };
    } catch (err) {
      const e = err as Error & { status?: number; issue?: string; debugId?: string };
      result.paypal = { ok: false, status: e.status, issue: e.issue, debugId: e.debugId };
    }
  }
  save("s3-fx-quote", result);
  show("S3 results", result);
});
