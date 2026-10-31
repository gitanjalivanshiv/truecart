// The spending mandate the user sets (SPEC 5.2). All caps are minor units in `currency`.

import { z } from "zod";
import { CurrencyCodeSchema, MinorAmountSchema } from "./money";

export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2, upper case");

const NonNegativeMinor = MinorAmountSchema.refine((v) => v >= 0, "must be >= 0");

export const MandateSchema = z
  .object({
    id: z.string().min(1),
    currency: CurrencyCodeSchema,
    perPurchaseCapMinor: NonNegativeMinor,
    monthlyCapMinor: NonNegativeMinor,
    approvalThresholdMinor: NonNegativeMinor,
    /** Guards against "buy 20 units" style injections even for cheap items. */
    maxUnitsPerPurchase: z.number().int().min(1).max(100).default(3),
    allowedMerchantCountries: z.array(CountryCodeSchema).min(1),
    allowedOrderCurrencies: z.array(CurrencyCodeSchema).min(1),
    /** Safety buffer added to cross-currency totals before comparing against caps. */
    maxFxSlackBps: z.number().int().min(0).max(2_000),
    /** Optional "cost of waiting" per delivery day, in mandate currency. */
    deliveryDayValueMinor: NonNegativeMinor.optional(),
    buyerCountry: CountryCodeSchema,
    fundingCurrency: CurrencyCodeSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    paused: z.boolean(),
    /** Vault payment token id. Never exposed to the LLM (see agentView). */
    walletTokenRef: z.string().min(1).nullable(),
  })
  .refine((m) => m.perPurchaseCapMinor <= m.monthlyCapMinor, {
    message: "per-purchase cap cannot exceed the monthly cap",
    path: ["perPurchaseCapMinor"],
  });

export type Mandate = z.infer<typeof MandateSchema>;
export type MandateInput = z.input<typeof MandateSchema>;

/** What the agent may see: everything except the wallet token. */
export function agentView(m: Mandate): Omit<Mandate, "walletTokenRef"> & { walletLinked: boolean } {
  const { walletTokenRef, ...rest } = m;
  return { ...rest, walletLinked: walletTokenRef !== null };
}
