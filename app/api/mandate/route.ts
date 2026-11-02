import { z } from "zod";
import { saveMandate } from "@/src/db/repositories";
import { CountryCodeSchema, MandateSchema } from "@/src/domain/mandate";
import { CurrencyCodeSchema, parseDecimal } from "@/src/domain/money";
import { handle, json, parseBody } from "@/src/server/http";
import { stateView } from "@/src/server/views";
import { workspace } from "@/src/server/visitor";

const Decimal = z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, "use an amount like 150 or 150.00");
const Patch = z.strictObject({
  perPurchaseCap: Decimal.optional(),
  monthlyCap: Decimal.optional(),
  approvalThreshold: Decimal.optional(),
  maxUnitsPerPurchase: z.number().int().min(1).max(100).optional(),
  allowedMerchantCountries: z.array(CountryCodeSchema).min(1).max(20).optional(),
  allowedOrderCurrencies: z.array(CurrencyCodeSchema).min(1).optional(),
  paused: z.boolean().optional(),
});

// The person edits their own mandate. The agent has no route here: it cannot change limits.
export const PATCH = handle(async (request: Request) => {
  const body = await parseBody(request, Patch);
  if (body instanceof Response) return body;
  const { db, mandate } = await workspace();
  const minor = (v: string | undefined, fallback: number) =>
    v === undefined ? fallback : parseDecimal(v, mandate.currency).amountMinor;
  const next = MandateSchema.safeParse({
    ...mandate,
    perPurchaseCapMinor: minor(body.perPurchaseCap, mandate.perPurchaseCapMinor),
    monthlyCapMinor: minor(body.monthlyCap, mandate.monthlyCapMinor),
    approvalThresholdMinor: minor(body.approvalThreshold, mandate.approvalThresholdMinor),
    maxUnitsPerPurchase: body.maxUnitsPerPurchase ?? mandate.maxUnitsPerPurchase,
    allowedMerchantCountries: body.allowedMerchantCountries ?? mandate.allowedMerchantCountries,
    allowedOrderCurrencies: body.allowedOrderCurrencies ?? mandate.allowedOrderCurrencies,
    paused: body.paused ?? mandate.paused,
  });
  if (!next.success) return json({ error: next.error.issues[0]?.message ?? "Invalid mandate." }, 400);
  saveMandate(db, next.data, new Date());
  return json(stateView(db, next.data));
});
