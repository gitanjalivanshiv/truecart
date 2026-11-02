// Discovery -> landed cost -> ranking -> policy dry run, for one mandate. Every number comes from the
// domain engines; the agent only ever reads these results.

import { evaluate, type PolicyResult } from "@/src/domain/policy";
import type { LedgerEntry } from "@/src/domain/ledger";
import { landedCost, rankOffers, type LandedCost, type RankedOffer } from "@/src/domain/landedCost";
import type { Mandate } from "@/src/domain/mandate";
import type { Quote } from "@/src/domain/money";
import { feeTable, importRules, shippingLanes } from "@/src/domain/referenceData";
import { displayLabels, type DisplayOffer } from "@/src/integrations/channel3/mask";
import type { NormalizedOffer } from "@/src/integrations/channel3/normalize";
import type { Discovery } from "./discover";

export interface RankedRow extends RankedOffer {
  offer: NormalizedOffer;
  display: DisplayOffer;
  groupId: string;
  policy: PolicyResult;
}

export interface RankResult {
  rows: RankedRow[];
  skipped: { offerId: string; reason: string }[];
}

export function rankDiscovery(
  discovery: Discovery,
  args: {
    mandate: Mandate;
    ledger: readonly LedgerEntry[];
    quotes: readonly Quote[];
    quantity?: number;
    maskBrands: boolean;
    now: Date;
  },
): RankResult {
  const { mandate, quotes } = args;
  const quantity = args.quantity ?? 1;
  const costs: LandedCost[] = [];
  const skipped: RankResult["skipped"] = [];
  const byId = new Map(discovery.offers.map((o) => [o.offerId, o]));

  for (const o of discovery.offers) {
    try {
      costs.push(
        landedCost(
          {
            offerId: o.offerId,
            merchantId: o.merchantId,
            merchantCountry: o.merchantCountry,
            countrySource: o.countrySource,
            unitPrice: o.unitPrice,
            quantity,
          },
          {
            buyerCountry: mandate.buyerCountry,
            fundingCurrency: mandate.fundingCurrency,
            reportingCurrency: mandate.currency,
            quotes,
            importRules,
            shippingLanes,
            fxSpreadBps: feeTable.buyerFxSpread.bps,
            deliveryDayValueMinor: mandate.deliveryDayValueMinor,
          },
        ),
      );
    } catch (err) {
      skipped.push({ offerId: o.offerId, reason: (err as Error).message });
    }
  }

  const display = displayLabels(discovery.offers, args.maskBrands);
  const groupOf = new Map(discovery.groups.flatMap((g) => g.offerIds.map((id) => [id, g.groupId] as const)));
  const rows = rankOffers(costs).map((r) => {
    const offer = byId.get(r.offerId)!;
    const policy = evaluate(
      mandate,
      args.ledger,
      {
        mandateId: mandate.id,
        offerId: r.offerId,
        merchantId: r.merchantId,
        merchantCountry: offer.merchantCountry,
        orderAmount: r.charged,
        landedTotal: r.total,
        quantity,
        confidence: r.confidence,
      },
      args.now,
    );
    return { ...r, offer, display: display.get(r.offerId)!, groupId: groupOf.get(r.offerId)!, policy };
  });
  return { rows, skipped };
}
