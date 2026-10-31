// Cart-bound, single-use approvals (SPEC 5.3). An approval binds the exact charge: mandate, offer, merchant,
// quantity, amount and currency. Any change (re-price, swapped merchant, more units) needs a new approval.

import type { PurchaseIntent } from "./policy";
import type { CurrencyCode } from "./money";

export interface ApprovalRecord {
  id: string;
  mandateId: string;
  offerId: string;
  merchantId: string;
  quantity: number;
  amountMinor: number;
  currency: CurrencyCode;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export type ApprovalProblem =
  | "APPROVAL_MISSING"
  | "APPROVAL_USED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_MANDATE_MISMATCH"
  | "APPROVAL_OFFER_MISMATCH"
  | "APPROVAL_MERCHANT_MISMATCH"
  | "APPROVAL_QUANTITY_MISMATCH"
  | "APPROVAL_AMOUNT_MISMATCH"
  | "APPROVAL_CURRENCY_MISMATCH";

export const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000;

export function createApproval(
  intent: PurchaseIntent,
  id: string,
  now: Date,
  ttlMs = DEFAULT_APPROVAL_TTL_MS,
): ApprovalRecord {
  return {
    id,
    mandateId: intent.mandateId,
    offerId: intent.offerId,
    merchantId: intent.merchantId,
    quantity: intent.quantity,
    amountMinor: intent.orderAmount.amountMinor,
    currency: intent.orderAmount.currency,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    usedAt: null,
  };
}

export function checkApproval(
  record: ApprovalRecord | undefined,
  intent: PurchaseIntent,
  now: Date,
): ApprovalProblem[] {
  if (!record) return ["APPROVAL_MISSING"];
  const problems: ApprovalProblem[] = [];
  if (record.usedAt !== null) problems.push("APPROVAL_USED");
  if (now.getTime() >= Date.parse(record.expiresAt)) problems.push("APPROVAL_EXPIRED");
  if (record.mandateId !== intent.mandateId) problems.push("APPROVAL_MANDATE_MISMATCH");
  if (record.offerId !== intent.offerId) problems.push("APPROVAL_OFFER_MISMATCH");
  if (record.merchantId !== intent.merchantId) problems.push("APPROVAL_MERCHANT_MISMATCH");
  if (record.quantity !== intent.quantity) problems.push("APPROVAL_QUANTITY_MISMATCH");
  if (record.amountMinor !== intent.orderAmount.amountMinor) problems.push("APPROVAL_AMOUNT_MISMATCH");
  if (record.currency !== intent.orderAmount.currency) problems.push("APPROVAL_CURRENCY_MISMATCH");
  return problems;
}

/** Marks the approval used. Persistence must do this atomically with the charge (compare-and-set on usedAt). */
export function consumeApproval(record: ApprovalRecord, now: Date): ApprovalRecord {
  if (record.usedAt !== null) throw new Error(`approval ${record.id} already used`);
  return { ...record, usedAt: now.toISOString() };
}
