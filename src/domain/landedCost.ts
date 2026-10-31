// Landed-cost engine (SPEC 5.4): what the buyer actually pays, per offer, in the mandate currency.
//
//   landed = item (- origin VAT removed on export) + shipping + import VAT + import duty
//            + FX conversion spread (only when the order currency differs from the funding currency)
//            + optional delivery penalty
//
// Pure. Every line is converted HALF_EVEN once; the total is the sum of the lines, so waterfalls add up.
// Each line says whether it is an estimate and on what basis. Never phrase these as facts in the UI.

import {
  add,
  applyBps,
  convert,
  money,
  multiply,
  removeIncludedBps,
  subtract,
  sum,
  zero,
  type CurrencyCode,
  type Money,
  type Quote,
} from "./money";
import type { Confidence } from "./policy";
import type { ImportRule, ShippingLane } from "./referenceData";

export interface OfferForCosting {
  offerId: string;
  merchantId: string;
  merchantCountry: string | null;
  /** How we know the country: offer domain TLD, the search locale, or not at all. */
  countrySource: "domain" | "locale" | "unknown";
  unitPrice: Money;
  quantity: number;
  /** Only when the merchant states shipping. Channel3 offers never do. */
  shipping?: { amount: Money; days: number };
}

export interface CostingContext {
  buyerCountry: string;
  fundingCurrency: CurrencyCode;
  /** Mandate currency: all lines and the total are expressed in it. */
  reportingCurrency: CurrencyCode;
  quotes: readonly Quote[];
  importRules: readonly ImportRule[];
  shippingLanes: readonly ShippingLane[];
  fxSpreadBps: number;
  /** Optional cost of waiting per delivery day, in reporting currency minor units. */
  deliveryDayValueMinor?: number;
}

export type LineKind =
  "item" | "originVatRemoved" | "shipping" | "importVat" | "importDuty" | "fxConversion" | "deliveryPenalty";

export interface CostLine {
  kind: LineKind;
  amount: Money; // reporting currency
  original?: Money; // the amount before conversion, when it differs
  estimate: boolean;
  basis: string;
}

export interface LandedCost {
  offerId: string;
  merchantId: string;
  lines: CostLine[];
  total: Money;
  /** The listed price converted at the base rate: what a sticker-price comparison would use. */
  sticker: Money;
  /** What PayPal will charge, in the order currency (item net + shipping + VAT collected at checkout). */
  charged: Money;
  deliveryDays: number | null;
  confidence: Confidence;
  warnings: string[];
}

export function landedCost(offer: OfferForCosting, ctx: CostingContext): LandedCost {
  const orderCurrency = offer.unitPrice.currency;
  const report = (m: Money) => convert(m, ctx.reportingCurrency, ctx.quotes, "HALF_EVEN");
  const warnings: string[] = [];
  let hardUnknown = false;
  let softFlags = 0;
  const lines: CostLine[] = [];
  const line = (kind: LineKind, original: Money, estimate: boolean, basis: string) => {
    const amount = report(original);
    lines.push({ kind, amount, ...(original.currency !== amount.currency && { original }), estimate, basis });
  };

  const origin = offer.merchantCountry;
  if (origin === null || offer.countrySource === "unknown") {
    hardUnknown = true;
    warnings.push("Merchant country unknown: import tax and shipping cannot be estimated.");
  } else if (offer.countrySource === "locale") {
    softFlags++;
    warnings.push("Merchant country inferred from the search market, not the store domain.");
  }

  const rule = origin
    ? ctx.importRules.find((r) => r.origin === origin && r.destination === ctx.buyerCountry)
    : undefined;
  if (origin && !rule) {
    hardUnknown = true;
    warnings.push(`No import rule for ${origin} -> ${ctx.buyerCountry}: import tax not estimated.`);
  }
  if (rule && rule.verifiedAt === null) softFlags++;

  // Item, net of origin VAT when the exporter removes it.
  const item = multiply(offer.unitPrice, offer.quantity);
  line("item", item, false, `listed price x ${offer.quantity}`);
  let itemNet = item;
  if (rule?.stripOriginVatOnExport && rule.originVatIncludedBps > 0) {
    itemNet = removeIncludedBps(item, rule.originVatIncludedBps, "HALF_EVEN");
    line(
      "originVatRemoved",
      subtract(itemNet, item),
      true,
      `${rule.originVatIncludedBps / 100}% origin VAT removed on export (assumption)`,
    );
  }

  // Shipping: merchant-stated, else the simulated lane table.
  let shipping = zero(orderCurrency);
  let deliveryDays: number | null = null;
  if (offer.shipping) {
    shipping = convert(offer.shipping.amount, orderCurrency, ctx.quotes, "HALF_EVEN");
    deliveryDays = offer.shipping.days;
    line("shipping", shipping, false, "stated by merchant");
  } else {
    const lane = origin
      ? ctx.shippingLanes.find((l) => l.origin === origin && l.destination === ctx.buyerCountry)
      : undefined;
    if (lane) {
      shipping = convert(money(lane.amountMinor, lane.currency), orderCurrency, ctx.quotes, "HALF_EVEN");
      deliveryDays = lane.days;
      softFlags++;
      line("shipping", shipping, true, `simulated ${lane.origin}->${lane.destination} rate`);
    } else {
      hardUnknown = true;
      warnings.push("No shipping data for this route.");
    }
  }

  // Import VAT and duty (cross-border only).
  let vatAtCheckout = zero(orderCurrency);
  if (rule && rule.origin !== rule.destination) {
    const threshold = rule.lowValueThreshold;
    const intrinsic = threshold ? convert(itemNet, threshold.currency, ctx.quotes, "HALF_EVEN") : null;
    const lowValue = threshold !== null && intrinsic !== null && intrinsic.amountMinor <= threshold.amountMinor;
    const vatBase = rule.vatOnShipping ? add(itemNet, shipping) : itemNet;

    if (lowValue) {
      vatAtCheckout = applyBps(vatBase, rule.importVatBps, "HALF_EVEN");
      line(
        "importVat",
        vatAtCheckout,
        true,
        `${rule.importVatBps / 100}% VAT charged by the seller at checkout (consignment <= threshold, no duty)`,
      );
    } else {
      let duty = zero(orderCurrency);
      if (rule.dutyBpsAboveThreshold === null) {
        hardUnknown = true;
        warnings.push(
          "Customs duty depends on the product type and is not estimated for consignments over the threshold.",
        );
      } else {
        duty = applyBps(add(itemNet, shipping), rule.dutyBpsAboveThreshold, "HALF_EVEN");
        line("importDuty", duty, true, `${rule.dutyBpsAboveThreshold / 100}% customs duty on import`);
      }
      const importVat = applyBps(add(vatBase, duty), rule.importVatBps, "HALF_EVEN");
      line("importVat", importVat, true, `${rule.importVatBps / 100}% import VAT paid to the carrier`);
    }
  }

  const charged = sum([itemNet, shipping, vatAtCheckout], orderCurrency);

  // FX conversion spread on what PayPal converts.
  if (orderCurrency !== ctx.fundingCurrency && ctx.fxSpreadBps > 0) {
    const chargedInFunding = convert(charged, ctx.fundingCurrency, ctx.quotes, "HALF_EVEN");
    line(
      "fxConversion",
      applyBps(chargedInFunding, ctx.fxSpreadBps, "HALF_EVEN"),
      true,
      `${ctx.fxSpreadBps / 100}% currency conversion spread (estimate)`,
    );
  }

  if (ctx.deliveryDayValueMinor && deliveryDays !== null) {
    line(
      "deliveryPenalty",
      money(ctx.deliveryDayValueMinor * deliveryDays, ctx.reportingCurrency),
      true,
      `your cost of waiting x ${deliveryDays} days`,
    );
  }

  const confidence: Confidence = hardUnknown || softFlags >= 3 ? "low" : softFlags === 0 ? "high" : "medium";
  return {
    offerId: offer.offerId,
    merchantId: offer.merchantId,
    lines,
    total: sum(
      lines.map((l) => l.amount),
      ctx.reportingCurrency,
    ),
    sticker: lines[0].amount,
    charged,
    deliveryDays,
    confidence,
    warnings,
  };
}

export interface RankedOffer extends LandedCost {
  stickerRank: number; // 1 = cheapest listed price
  trueRank: number; // 1 = cheapest landed cost
  /** Facts for the explanation, versus the cheapest-sticker offer. The LLM phrases these; it never computes them. */
  vsStickerLeader: {
    offerId: string;
    totalDeltaMinor: number;
    drivers: { kind: LineKind; deltaMinor: number }[];
  } | null;
}

export function rankOffers(costs: readonly LandedCost[]): RankedOffer[] {
  if (costs.length === 0) return [];
  const currency = costs[0].total.currency;
  if (costs.some((c) => c.total.currency !== currency)) throw new Error("rankOffers needs a single reporting currency");

  const byKey = (key: (c: LandedCost) => number) =>
    [...costs].sort((a, b) => key(a) - key(b) || a.offerId.localeCompare(b.offerId)).map((c) => c.offerId);
  const stickerOrder = byKey((c) => c.sticker.amountMinor);
  const trueOrder = byKey((c) => c.total.amountMinor);
  const leader = costs.find((c) => c.offerId === stickerOrder[0])!;
  const kindTotal = (c: LandedCost, kind: LineKind) =>
    c.lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount.amountMinor, 0);
  const kinds: LineKind[] = [
    "item",
    "originVatRemoved",
    "shipping",
    "importVat",
    "importDuty",
    "fxConversion",
    "deliveryPenalty",
  ];

  return costs
    .map((c) => ({
      ...c,
      stickerRank: stickerOrder.indexOf(c.offerId) + 1,
      trueRank: trueOrder.indexOf(c.offerId) + 1,
      vsStickerLeader:
        c.offerId === leader.offerId
          ? null
          : {
              offerId: leader.offerId,
              totalDeltaMinor: c.total.amountMinor - leader.total.amountMinor,
              drivers: kinds
                .map((kind) => ({ kind, deltaMinor: kindTotal(c, kind) - kindTotal(leader, kind) }))
                .filter((d) => d.deltaMinor !== 0)
                .sort((a, b) => Math.abs(b.deltaMinor) - Math.abs(a.deltaMinor)),
            },
    }))
    .sort((a, b) => a.trueRank - b.trueRank);
}
