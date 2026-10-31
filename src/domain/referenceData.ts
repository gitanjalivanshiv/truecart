// Schemas for the reference tables in data/. Loaded and validated once; the engines take them as arguments.

import { z } from "zod";
import feesJson from "@/data/fees.json";
import importRulesJson from "@/data/import_rules.json";
import shippingJson from "@/data/shipping_table.json";
import { CountryCodeSchema } from "./mandate";
import { CurrencyCodeSchema, MinorAmountSchema } from "./money";

const Bps = z.number().int().min(0).max(10_000);

export const ImportRuleSchema = z.object({
  id: z.string(),
  origin: CountryCodeSchema,
  destination: CountryCodeSchema,
  /** Origin VAT included in listed prices (e.g. 1900 for German 19%). */
  originVatIncludedBps: Bps,
  stripOriginVatOnExport: z.boolean(),
  importVatBps: Bps,
  vatOnShipping: z.boolean(),
  /** At or below this intrinsic value: VAT collected by the seller at checkout, no duty. */
  lowValueThreshold: z.object({ amountMinor: MinorAmountSchema, currency: CurrencyCodeSchema }).nullable(),
  /** null = commodity-specific and not estimated. */
  dutyBpsAboveThreshold: Bps.nullable(),
  sources: z.array(z.url()).min(1),
  verifiedAt: z.iso.date().nullable(),
  note: z.string(),
});
export type ImportRule = z.infer<typeof ImportRuleSchema>;

export const ShippingLaneSchema = z.object({
  origin: CountryCodeSchema,
  destination: CountryCodeSchema,
  amountMinor: MinorAmountSchema,
  currency: CurrencyCodeSchema,
  days: z.number().int().min(0),
});
export type ShippingLane = z.infer<typeof ShippingLaneSchema>;

export const FeeTableSchema = z.object({
  merchant: z.object({
    percentBps: Bps,
    internationalBps: Bps,
    fixedMinor: z.partialRecord(CurrencyCodeSchema, MinorAmountSchema),
    source: z.url(),
    verifiedAt: z.iso.date().nullable(),
    note: z.string(),
  }),
  buyerFxSpread: z.object({ bps: Bps, source: z.url(), verifiedAt: z.iso.date().nullable(), note: z.string() }),
});
export type FeeTable = z.infer<typeof FeeTableSchema>;

export const importRules: readonly ImportRule[] = z.array(ImportRuleSchema).parse(importRulesJson.rules);
export const shippingLanes: readonly ShippingLane[] = z.array(ShippingLaneSchema).parse(shippingJson.lanes);
export const feeTable: FeeTable = FeeTableSchema.parse(feesJson);
