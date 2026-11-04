// JSON view models for the UI. Money is sent as minor units + currency + a formatted string; the browser
// never computes money. Nothing here exposes wallet tokens, store domains (when masked) or PayPal secrets.

import type { Db } from "@/src/db/database";
import { proposalsForMandate, type Proposal } from "@/src/db/proposals";
import { ledgerForMandate, purchasesForMandate, webhookEventsForPurchases } from "@/src/db/repositories";
import { merchantFee } from "@/src/domain/fees";
import { committedThisMonth } from "@/src/domain/ledger";
import type { Mandate } from "@/src/domain/mandate";
import { parseDecimal, toDecimalString, type Money } from "@/src/domain/money";
import { feeTable } from "@/src/domain/referenceData";
import type { StoredSearch } from "@/src/agent/searchStore";
import { demoWalletToken } from "./visitor";

/** The single sandbox business account that receives every payment (merchants are simulated). */
const MERCHANT_OF_RECORD_COUNTRY = "US";

export interface MoneyView {
  minor: number;
  currency: string;
  text: string;
}
export const mv = (m: Money): MoneyView => ({
  minor: m.amountMinor,
  currency: m.currency,
  text: `${toDecimalString(m)} ${m.currency}`,
});
const mm = (minor: number, currency: Money["currency"]) => mv({ amountMinor: minor, currency });

export function stateView(db: Db, mandate: Mandate, now = new Date()) {
  const spent = committedThisMonth(ledgerForMandate(db, mandate.id), mandate.id, mandate.currency, now);
  const awaiting = proposalsForMandate(db, mandate.id).filter((p) => p.status === "AWAITING_APPROVAL").length;
  return {
    mandate: {
      currency: mandate.currency,
      perPurchaseCap: mm(mandate.perPurchaseCapMinor, mandate.currency),
      monthlyCap: mm(mandate.monthlyCapMinor, mandate.currency),
      approvalThreshold: mm(mandate.approvalThresholdMinor, mandate.currency),
      maxUnitsPerPurchase: mandate.maxUnitsPerPurchase,
      allowedMerchantCountries: mandate.allowedMerchantCountries,
      allowedOrderCurrencies: mandate.allowedOrderCurrencies,
      maxFxSlackBps: mandate.maxFxSlackBps,
      buyerCountry: mandate.buyerCountry,
      fundingCurrency: mandate.fundingCurrency,
      expiresAt: mandate.expiresAt,
      paused: mandate.paused,
    },
    wallet: {
      linked: mandate.walletTokenRef !== null,
      kind:
        mandate.walletTokenRef === null
          ? null
          : mandate.walletTokenRef === demoWalletToken()
            ? "shared-sandbox-buyer"
            : "your-sandbox-wallet",
      demoWalletAvailable: demoWalletToken() !== null,
    },
    spend: {
      committed: mm(spent, mandate.currency),
      remaining: mm(Math.max(0, mandate.monthlyCapMinor - spent), mandate.currency),
      monthlyCap: mm(mandate.monthlyCapMinor, mandate.currency),
    },
    awaitingApprovals: awaiting,
  };
}

export function proposalView(p: Proposal) {
  return {
    id: p.id,
    status: p.status,
    createdAt: p.createdAt,
    quantity: p.intent.quantity,
    title: p.display.title,
    merchant: p.display.merchant,
    merchantCountry: p.display.merchantCountry,
    price: p.display.price,
    landedTotal: p.display.landedTotal,
    lines: p.display.lines,
    confidence: p.display.confidence,
    charge: mv(p.intent.orderAmount),
    decision: p.policy.decision,
    reasons: p.policy.reasons,
    worstCase: p.policy.worstCaseTotalMinor === null ? null : mm(p.policy.worstCaseTotalMinor, p.policy.currency),
    outcome: p.outcome
      ? {
          status: p.outcome.status,
          ...("code" in p.outcome && { code: p.outcome.code }),
          ...("orderId" in p.outcome && { orderId: p.outcome.orderId }),
        }
      : null,
  };
}

type Breakdown = {
  gross_amount?: { value: string; currency_code: string };
  paypal_fee?: { value: string; currency_code: string };
  net_amount?: { value: string; currency_code: string };
  receivable_amount?: { value: string; currency_code: string };
  exchange_rate?: { value: string; source_currency?: string; target_currency?: string };
};

const moneyOf = (a?: { value: string; currency_code: string }) => {
  if (!a) return null;
  try {
    return mv(parseDecimal(a.value, a.currency_code));
  } catch {
    return null;
  }
};

export function ledgerView(db: Db, mandate: Mandate) {
  // Every purchase records the proposal it came from, so join on that: it works while a payment is still
  // in flight, before the proposal is finished.
  const proposals = new Map(proposalsForMandate(db, mandate.id, 500).map((p) => [p.id, p]));
  return purchasesForMandate(db, mandate.id).map((p) => {
    const prop = proposals.get(p.proposalId);
    const charge = { amountMinor: p.orderAmountMinor, currency: p.orderCurrency } as Money;
    const b = (p.sellerBreakdown ?? {}) as Breakdown;
    // "Merchant pays" model vs PayPal's actual fee. Every charge is received by the US sandbox merchant of
    // record, so the international fee applies whenever the buyer is outside the US.
    const international = mandate.buyerCountry !== MERCHANT_OF_RECORD_COUNTRY;
    let predictedFee: MoneyView | null = null;
    try {
      predictedFee = mv(merchantFee(charge, international, feeTable.merchant).total);
    } catch {
      predictedFee = null;
    }
    const actualFee = moneyOf(b.paypal_fee);
    const feeErrorPct =
      predictedFee && actualFee && actualFee.minor > 0
        ? Math.round(((predictedFee.minor - actualFee.minor) / actualFee.minor) * 1000) / 10
        : null;
    return {
      purchaseId: p.id,
      createdAt: p.createdAt,
      status: p.status,
      // Never fall back to raw ids or store domains: they would bypass brand masking.
      title: prop?.display.title ?? "Purchase",
      merchant: prop?.display.merchant ?? "Store",
      quantity: p.quantity,
      authorizedVia: p.authorizedVia,
      charged: mv(charge),
      landedEstimate: mm(p.landedTotalMinor, p.landedCurrency as Money["currency"]),
      paypalOrderId: p.paypalOrderId,
      captureStatus: p.captureStatus,
      errorCode: p.errorCode,
      actual: {
        gross: moneyOf(b.gross_amount),
        paypalFee: actualFee,
        net: moneyOf(b.net_amount),
        receivable: moneyOf(b.receivable_amount),
        exchangeRate: b.exchange_rate?.value ?? null,
      },
      predictedMerchantFee: predictedFee,
      feeModelErrorPct: feeErrorPct,
    };
  });
}

/** Paid totals per charge currency (the grid pins them under the ledger). Money is summed here, never in the browser. */
export function ledgerTotals(rows: ReturnType<typeof ledgerView>) {
  const by = new Map<
    string,
    { count: number; charged: number; fee: number; feeRows: number; pred: number; act: number }
  >();
  for (const r of rows) {
    if (r.status !== "CAPTURED") continue;
    const t = by.get(r.charged.currency) ?? { count: 0, charged: 0, fee: 0, feeRows: 0, pred: 0, act: 0 };
    t.count++;
    t.charged += r.charged.minor;
    const fee = r.actual.paypalFee;
    if (fee && fee.currency === r.charged.currency) {
      t.fee += fee.minor;
      t.feeRows++;
      if (r.predictedMerchantFee && r.predictedMerchantFee.currency === fee.currency) {
        t.pred += r.predictedMerchantFee.minor;
        t.act += fee.minor;
      }
    }
    by.set(r.charged.currency, t);
  }
  return [...by.entries()].map(([currency, t]) => {
    const c = currency as Money["currency"];
    return {
      currency,
      count: t.count,
      charged: mm(t.charged, c),
      paypalFee: t.feeRows ? mm(t.fee, c) : null,
      predictedMerchantFee: t.act ? mm(t.pred, c) : null,
      feeModelErrorPct: t.act ? Math.round(((t.pred - t.act) / t.act) * 1000) / 10 : null,
    };
  });
}

export function activityView(db: Db, mandate: Mandate) {
  const purchases = purchasesForMandate(db, mandate.id);
  const calls = purchases
    .filter((p) => p.status !== "RESERVED")
    .map((p) => ({
      at: p.updatedAt,
      kind: "order" as const,
      label: `POST /v2/checkout/orders`,
      detail: p.paypalOrderId
        ? `order ${p.paypalOrderId} · ${p.captureStatus ?? p.status}`
        : `${p.status}${p.errorCode ? ` · ${p.errorCode}` : ""}`,
      status: p.status,
      response: p.paypalResponse,
    }));
  const hooks = webhookEventsForPurchases(
    db,
    purchases.map((p) => p.id),
    purchases.map((p) => p.paypalCaptureId).filter((x): x is string => !!x),
  ).map((w) => ({
    at: w.receivedAt,
    kind: "webhook" as const,
    label: w.eventType,
    detail: `event ${w.id} · signature verified`,
    status: "RECEIVED",
    response: null,
  }));
  return [...calls, ...hooks].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
}

export function searchView(s: StoredSearch) {
  const groupSize = new Map(s.groups.map((g) => [g.groupId, g]));
  return {
    id: s.id,
    query: s.query,
    quantity: s.quantity,
    via: s.via,
    createdAt: s.createdAt,
    fxSource: s.fxSource,
    rates: s.quotes.map((q) => ({ pair: `${q.from}/${q.to}`, rate: q.rate, asOf: q.asOf })),
    markets: s.markets,
    rows: s.rows.map((r) => {
      const g = groupSize.get(r.groupId);
      return {
        offerId: r.offerId,
        title: r.display.title,
        brand: r.display.brand,
        store: r.display.merchant,
        market: r.offer.market,
        merchantCountry: r.offer.merchantCountry,
        countrySource: r.offer.countrySource,
        price: mv(r.offer.unitPrice),
        sticker: mv(r.sticker),
        landed: mv(r.total),
        charged: mv(r.charged),
        stickerRank: r.stickerRank,
        trueRank: r.trueRank,
        confidence: r.confidence,
        decision: r.policy.decision,
        reasons: r.policy.reasons.filter((x) => x !== "WITHIN_LIMITS"),
        deliveryDays: r.deliveryDays,
        warnings: r.warnings,
        lines: r.lines.map((l) => ({ kind: l.kind, amount: mv(l.amount), estimate: l.estimate, basis: l.basis })),
        sameProduct:
          g && g.offerIds.length > 1 ? { match: g.match, markets: g.markets, count: g.offerIds.length } : null,
        vsSticker: r.vsStickerLeader
          ? {
              total: mm(r.vsStickerLeader.totalDeltaMinor, r.total.currency),
              drivers: r.vsStickerLeader.drivers.map((d) => ({
                kind: d.kind,
                delta: mm(d.deltaMinor, r.total.currency),
              })),
            }
          : null,
      };
    }),
  };
}
