// Live check of the executor against PayPal sandbox, using the wallet vaulted in spike S1.
//   npm run smoke:executor
// Uses a throwaway SQLite file under scripts/spikes/.out (git-ignored). Sandbox only: no real money.

import { rmSync } from "node:fs";
import { openDatabase } from "@/src/db/database";
import { ledgerForMandate, saveMandate } from "@/src/db/repositories";
import { MandateSchema } from "@/src/domain/mandate";
import { money } from "@/src/domain/money";
import { buy } from "@/src/executor/executor";
import { paypalGateway } from "@/src/executor/gateway";
import { load, requireEnv, run, show } from "../spikes/_lib";

run(async () => {
  requireEnv("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET");
  const vaultId = load<{ vaultId?: string }>("s1-vault")?.vaultId;
  if (!vaultId) throw new Error("no vaulted wallet: run spike S1 first (npm run spike:vault -- setup/token)");

  const path = "scripts/spikes/.out/smoke-executor.db";
  rmSync(path, { force: true });
  const db = openDatabase(path);
  const now = new Date();
  saveMandate(
    db,
    MandateSchema.parse({
      id: "smoke-mandate",
      currency: "GBP",
      perPurchaseCapMinor: 15_000,
      monthlyCapMinor: 40_000,
      approvalThresholdMinor: 5_000,
      allowedMerchantCountries: ["GB", "US", "DE"],
      allowedOrderCurrencies: ["GBP", "USD", "EUR"],
      maxFxSlackBps: 200,
      buyerCountry: "GB",
      fundingCurrency: "GBP",
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      paused: false,
      walletTokenRef: vaultId,
    }),
    now,
  );
  const deps = { db, gateway: paypalGateway };
  const base = { mandateId: "smoke-mandate", quantity: 1, confidence: "medium" as const };
  const proposal = `smoke-${now.getTime()}`;

  const gb = await buy(deps, {
    proposalId: `${proposal}-gb`,
    merchantLabel: "SMOKE-GB",
    intent: {
      ...base,
      offerId: "smoke-gb",
      merchantId: "smoke-gb",
      merchantCountry: "GB",
      orderAmount: money(500, "GBP"),
      landedTotal: money(899, "GBP"),
    },
  });
  show("GBP purchase", gb);

  const us = await buy(deps, {
    proposalId: `${proposal}-us`,
    merchantLabel: "SMOKE-US",
    intent: {
      ...base,
      offerId: "smoke-us",
      merchantId: "smoke-us",
      merchantCountry: "US",
      orderAmount: money(700, "USD"),
      landedTotal: money(900, "GBP"),
    },
  });
  show("USD purchase", us);

  const replay = await buy(deps, {
    proposalId: `${proposal}-gb`,
    intent: {
      ...base,
      offerId: "smoke-gb",
      merchantId: "smoke-gb",
      merchantCountry: "GB",
      orderAmount: money(500, "GBP"),
      landedTotal: money(899, "GBP"),
    },
  });
  show("replay of the GBP proposal (must not charge again)", replay);

  show(
    "ledger",
    ledgerForMandate(db, "smoke-mandate").map((e) => ({
      status: e.status,
      amountMinor: e.amountMinor,
      currency: e.currency,
    })),
  );
  db.close();
});
