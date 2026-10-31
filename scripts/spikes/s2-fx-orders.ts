// S2 — GBP/EUR (and USD baseline) orders on the US sandbox business account; inspect seller_receivable_breakdown.
//   npm run spike:fx-orders                       -> vault path (needs S1 token): charges USD, GBP, EUR
//   npm run spike:fx-orders -- approve --currency GBP  -> fallback: buyer-approved order, prints approve URL
//   npm run spike:fx-orders -- capture <orderId>
// If GBP/EUR are blocked: sandbox business account > Account Settings > Payment preferences > Block payments
// (allow payments in currencies you don't hold; choose accept+convert or open a balance) — record which.

import { arg, load, requireEnv, run, save, show } from "./_lib";
import { captureOrder, chargeVaulted, createApprovalOrder } from "./_orders";

run(async () => {
  requireEnv("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET");
  const cmd = process.argv[2] ?? "vault";

  if (cmd === "approve") {
    const currency = arg("currency", "GBP")!;
    const summary = await createApprovalOrder(
      currency,
      arg("amount", "10.00")!,
      `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/spike/return`,
    );
    show("order created (approve in browser, then capture)", { ...summary, approveLink: undefined });
    console.log(`\nApprove: ${summary.approveLink}\nThen: npm run spike:fx-orders -- capture ${summary.orderId}`);
    return;
  }

  if (cmd === "capture") {
    const id = process.argv[3];
    if (!id) throw new Error("usage: capture <orderId>");
    const summary = await captureOrder(id);
    save(`s2-capture-${id}`, summary);
    show("capture", summary);
    return;
  }

  const s1 = load<{ vaultId?: string; usagePattern?: string }>("s1-vault");
  if (!s1?.vaultId) throw new Error("no vault id: complete S1 (setup/token) first, or use the approve path");
  const results: Record<string, unknown> = {};
  for (const [currency, value] of [
    ["USD", "10.00"],
    ["GBP", "10.00"],
    ["EUR", "10.00"],
  ] as const) {
    try {
      const { summary } = await chargeVaulted({
        vaultId: s1.vaultId,
        currency,
        value,
        usagePattern: s1.usagePattern,
        merchantLabel: `SPIKE-S2-${currency}`,
      });
      results[currency] = summary;
    } catch (err) {
      const e = err as Error & { status?: number; issue?: string; debugId?: string };
      results[currency] = { error: e.message, status: e.status, issue: e.issue, debugId: e.debugId };
    }
  }
  save("s2-fx-orders", results);
  show("S2 results", results);
});
