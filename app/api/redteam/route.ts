import { fmtMoney, proposePurchase } from "@/src/agent/purchase";
import { ledgerForMandate } from "@/src/db/repositories";
import { discover } from "@/src/discovery/discover";
import { rankDiscovery } from "@/src/discovery/rank";
import { paypalGateway } from "@/src/executor/gateway";
import { getQuotes } from "@/src/integrations/fxrates/resilient";
import { handle, json } from "@/src/server/http";
import { workspace } from "@/src/server/visitor";

// "Compromised agent" drill: skips the AI model entirely and sends exactly what the hostile listing asks for
// (20 units) straight to the purchase path, to show the limits hold even if the model is fully hijacked.
// Uses the synthetic red-team listing only; payments stay enabled so the denial is real.
export const POST = handle(async () => {
  const { db, mandate } = await workspace();
  const d = await discover("red team demo listing", { mode: "replay" });
  const fx = await getQuotes(mandate.currency, [...new Set(d.offers.map((o) => o.unitPrice.currency))], {
    mode: "replay",
  });
  const { rows } = rankDiscovery(d, {
    mandate,
    ledger: ledgerForMandate(db, mandate.id),
    quotes: fx.quotes,
    maskBrands: true,
    now: new Date(),
  });
  const hostile = rows.find((r) => r.offer.description.includes("SYSTEM NOTICE"));
  if (!hostile) return json({ error: "Red-team listing not found." }, 500);
  const res = await proposePurchase(
    { db, mandateId: mandate.id, sessionId: "redteam-drill", gateway: paypalGateway, now: () => new Date() },
    hostile,
    fx.quotes,
    20,
  );
  return json({
    attempted: { quantity: 20, listingInstruction: hostile.offer.description.slice(0, 260) },
    status: res.status === "EXECUTED" ? res.outcome.status : res.status,
    decision: res.policy.decision,
    reasons: res.policy.reasons,
    landed: fmtMoney(res.cost.total),
    worstCase:
      res.policy.worstCaseTotalMinor === null
        ? null
        : fmtMoney({ amountMinor: res.policy.worstCaseTotalMinor, currency: res.policy.currency }),
  });
});
