// Deterministic policy engine (SPEC 5.3). Pure: no network, no clock reads (pass `now`).
//
// Intents must be built server-side from cached offer data and the landed-cost engine. The LLM supplies at
// most an offer id and a quantity; it never supplies amounts, countries or currencies.
//
// Every applicable reason is reported (not just the first), so the UI can explain the whole decision.
// Decision = DENIED if any deny reason, else NEEDS_APPROVAL if any approval reason, else AUTO.

import { committedThisMonth, type LedgerEntry } from "./ledger";
import type { Mandate } from "./mandate";
import { applyBps, money, type Money } from "./money";

export type Decision = "AUTO" | "NEEDS_APPROVAL" | "DENIED";
export type Confidence = "high" | "medium" | "low";

export const DENY_REASONS = [
  "MANDATE_MISMATCH",
  "MANDATE_PAUSED",
  "MANDATE_EXPIRED",
  "WALLET_NOT_LINKED",
  "UNKNOWN_MERCHANT",
  "MERCHANT_COUNTRY_UNKNOWN",
  "MERCHANT_COUNTRY_NOT_ALLOWED",
  "ORDER_CURRENCY_NOT_ALLOWED",
  "LANDED_CURRENCY_MISMATCH",
  "INVALID_AMOUNT",
  "INVALID_QUANTITY",
  "QUANTITY_EXCEEDS_LIMIT",
  "EXCEEDS_PER_PURCHASE_CAP",
  "EXCEEDS_MONTHLY_CAP",
] as const;
export const APPROVAL_REASONS = ["ABOVE_APPROVAL_THRESHOLD", "LOW_CONFIDENCE_ESTIMATE"] as const;
export const AUTO_REASONS = ["WITHIN_LIMITS"] as const;

export type DenyReason = (typeof DENY_REASONS)[number];
export type ApprovalReason = (typeof APPROVAL_REASONS)[number];
export type ReasonCode = DenyReason | ApprovalReason | (typeof AUTO_REASONS)[number];

const DENY = new Set<string>(DENY_REASONS);
const APPROVE = new Set<string>(APPROVAL_REASONS);

export interface PurchaseIntent {
  mandateId: string;
  offerId: string;
  merchantId: string;
  /** null = could not be determined; denied by default. */
  merchantCountry: string | null;
  /** What PayPal will charge, in the order currency. */
  orderAmount: Money;
  /** Landed cost from domain/landedCost, in mandate currency. */
  landedTotal: Money;
  quantity: number;
  confidence: Confidence;
}

export interface PolicyResult {
  decision: Decision;
  reasons: ReasonCode[];
  /** Landed total plus FX slack (CEIL), in mandate currency. null when the intent is malformed. */
  worstCaseTotalMinor: number | null;
  remainingMonthlyMinor: number;
  currency: Mandate["currency"];
}

export function worstCaseTotal(mandate: Mandate, intent: PurchaseIntent): Money {
  // FX can move between ranking and capture whenever the order is not in the mandate currency.
  if (intent.orderAmount.currency === mandate.currency) return intent.landedTotal;
  const slack = applyBps(intent.landedTotal, mandate.maxFxSlackBps, "CEIL");
  return money(intent.landedTotal.amountMinor + slack.amountMinor, intent.landedTotal.currency);
}

export function evaluate(
  mandate: Mandate,
  ledger: readonly LedgerEntry[],
  intent: PurchaseIntent,
  now: Date,
): PolicyResult {
  const reasons: ReasonCode[] = [];
  const remaining = Math.max(
    0,
    mandate.monthlyCapMinor - committedThisMonth(ledger, mandate.id, mandate.currency, now),
  );

  if (intent.mandateId !== mandate.id) reasons.push("MANDATE_MISMATCH");
  if (mandate.paused) reasons.push("MANDATE_PAUSED");
  if (now.getTime() >= Date.parse(mandate.expiresAt)) reasons.push("MANDATE_EXPIRED");
  if (mandate.walletTokenRef === null) reasons.push("WALLET_NOT_LINKED");

  if (!intent.merchantId.trim()) reasons.push("UNKNOWN_MERCHANT");
  if (intent.merchantCountry === null || !/^[A-Z]{2}$/.test(intent.merchantCountry)) {
    reasons.push("MERCHANT_COUNTRY_UNKNOWN");
  } else if (!mandate.allowedMerchantCountries.includes(intent.merchantCountry)) {
    reasons.push("MERCHANT_COUNTRY_NOT_ALLOWED");
  }
  if (!mandate.allowedOrderCurrencies.includes(intent.orderAmount.currency)) reasons.push("ORDER_CURRENCY_NOT_ALLOWED");

  if (!Number.isSafeInteger(intent.quantity) || intent.quantity < 1) reasons.push("INVALID_QUANTITY");
  else if (intent.quantity > mandate.maxUnitsPerPurchase) reasons.push("QUANTITY_EXCEEDS_LIMIT");

  const amountsValid =
    Number.isSafeInteger(intent.orderAmount.amountMinor) &&
    Number.isSafeInteger(intent.landedTotal.amountMinor) &&
    intent.orderAmount.amountMinor > 0 &&
    intent.landedTotal.amountMinor > 0;
  if (!amountsValid) reasons.push("INVALID_AMOUNT");

  let worstCase: number | null = null;
  if (intent.landedTotal.currency !== mandate.currency) {
    reasons.push("LANDED_CURRENCY_MISMATCH");
  } else if (amountsValid) {
    worstCase = worstCaseTotal(mandate, intent).amountMinor;
    if (worstCase > mandate.perPurchaseCapMinor) reasons.push("EXCEEDS_PER_PURCHASE_CAP");
    if (worstCase > remaining) reasons.push("EXCEEDS_MONTHLY_CAP");
    if (worstCase > mandate.approvalThresholdMinor) reasons.push("ABOVE_APPROVAL_THRESHOLD");
  }
  if (intent.confidence === "low") reasons.push("LOW_CONFIDENCE_ESTIMATE");

  const decision: Decision = reasons.some((r) => DENY.has(r))
    ? "DENIED"
    : reasons.some((r) => APPROVE.has(r))
      ? "NEEDS_APPROVAL"
      : "AUTO";
  if (decision === "AUTO") reasons.push("WITHIN_LIMITS");

  return {
    decision,
    reasons,
    worstCaseTotalMinor: worstCase,
    remainingMonthlyMinor: remaining,
    currency: mandate.currency,
  };
}
