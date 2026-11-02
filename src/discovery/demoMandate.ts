// The demo mandate (GB buyer, SPEC 13.1). Used by the CLI demo and, later, the seed script.
import { MandateSchema, type Mandate } from "@/src/domain/mandate";

export function demoMandate(walletTokenRef: string | null, now = new Date()): Mandate {
  return MandateSchema.parse({
    id: "demo-mandate",
    currency: "GBP",
    perPurchaseCapMinor: 15_000, // £150
    monthlyCapMinor: 40_000, // £400
    approvalThresholdMinor: 4_000, // auto-buy up to £40 ("under £40" in the hero request)
    maxUnitsPerPurchase: 3,
    allowedMerchantCountries: ["GB", "US", "DE"],
    allowedOrderCurrencies: ["GBP", "USD", "EUR"],
    maxFxSlackBps: 200,
    buyerCountry: "GB",
    fundingCurrency: "GBP",
    expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
    paused: false,
    walletTokenRef,
  });
}
