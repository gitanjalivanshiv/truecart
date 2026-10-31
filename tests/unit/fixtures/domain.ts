import { MandateSchema, type Mandate, type MandateInput } from "@/src/domain/mandate";
import { money } from "@/src/domain/money";
import type { PurchaseIntent } from "@/src/domain/policy";

export const NOW = new Date("2026-11-15T12:00:00Z");

/** GBP mandate: £150 per purchase, £400 a month, approval above £50, 2% FX slack. */
export function mandate(overrides: Partial<MandateInput> = {}): Mandate {
  return MandateSchema.parse({
    id: "mandate-1",
    currency: "GBP",
    perPurchaseCapMinor: 15_000,
    monthlyCapMinor: 40_000,
    approvalThresholdMinor: 5_000,
    maxUnitsPerPurchase: 3,
    allowedMerchantCountries: ["GB", "US", "DE"],
    allowedOrderCurrencies: ["GBP", "USD", "EUR"],
    maxFxSlackBps: 200,
    buyerCountry: "GB",
    fundingCurrency: "GBP",
    expiresAt: "2026-12-31T23:59:59Z",
    paused: false,
    walletTokenRef: "vault-token-1",
    ...overrides,
  });
}

/** £30 GB purchase, landed £30. AUTO under the default mandate. */
export function intent(overrides: Partial<PurchaseIntent> = {}): PurchaseIntent {
  return {
    mandateId: "mandate-1",
    offerId: "offer-1",
    merchantId: "merchant-gb-1",
    merchantCountry: "GB",
    orderAmount: money(3_000, "GBP"),
    landedTotal: money(3_000, "GBP"),
    quantity: 1,
    confidence: "medium",
    ...overrides,
  };
}
