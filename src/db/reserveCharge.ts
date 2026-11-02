// The atomic step before any PayPal call. In ONE write transaction:
//   1. replay check: the same proposal (same PayPal-Request-Id) returns the existing purchase, never a second one;
//   2. load the mandate and ledger fresh from the database and re-run authorizeCharge;
//   3. consume the approval with compare-and-set when the policy needs one;
//   4. reserve the worst-case amount (PENDING ledger entry) and record the purchase.
// The PayPal call happens after commit; the reservation guarantees the monthly cap even if it races.

import { createHash, randomUUID } from "node:crypto";
import { authorizeCharge } from "@/src/domain/authorize";
import type { ApprovalProblem } from "@/src/domain/approval";
import type { PolicyResult, PurchaseIntent, ReasonCode } from "@/src/domain/policy";
import { transaction, type Db } from "./database";
import {
  consumeApproval,
  getApproval,
  getMandate,
  getPurchaseByRequestId,
  ledgerForMandate,
  type PurchaseRecord,
} from "./repositories";

/** Deterministic PayPal-Request-Id: same mandate + proposal => same id => PayPal returns the same order. */
export function requestIdFor(mandateId: string, proposalId: string): string {
  return `tc-${createHash("sha256").update(`${mandateId}\u0000${proposalId}`).digest("hex").slice(0, 32)}`;
}

export type ReserveResult =
  | { ok: true; replay: boolean; purchase: PurchaseRecord; policy: PolicyResult | null }
  | { ok: false; reasons: (ReasonCode | ApprovalProblem | "MANDATE_NOT_FOUND")[]; policy: PolicyResult | null };

export function reserveCharge(
  db: Db,
  args: { proposalId: string; intent: PurchaseIntent; approvalId?: string; now: Date },
): ReserveResult {
  const { proposalId, intent, approvalId, now } = args;
  const requestId = requestIdFor(intent.mandateId, proposalId);

  return transaction(db, () => {
    const existing = getPurchaseByRequestId(db, requestId);
    if (existing) return { ok: true, replay: true, purchase: existing, policy: null };

    const mandate = getMandate(db, intent.mandateId);
    if (!mandate) return { ok: false, reasons: ["MANDATE_NOT_FOUND"], policy: null };

    const approval = approvalId ? getApproval(db, approvalId) : undefined;
    const auth = authorizeCharge({ mandate, ledger: ledgerForMandate(db, mandate.id), intent, approval, now });
    if (!auth.allowed) return { ok: false, reasons: auth.reasons, policy: auth.policy };

    if (auth.via === "APPROVAL") {
      // Lost a race for the same approval (or it expired between check and use): nothing is written.
      if (!approval || !consumeApproval(db, approval.id, now)) {
        return { ok: false, reasons: ["APPROVAL_USED"], policy: auth.policy };
      }
    }

    const iso = now.toISOString();
    const purchaseId = `pur_${randomUUID()}`;
    db.prepare(
      `INSERT INTO purchases (id, request_id, proposal_id, mandate_id, offer_id, merchant_id, quantity,
         order_amount_minor, order_currency, landed_total_minor, landed_currency, approval_id, authorized_via,
         status, policy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?)`,
    ).run(
      purchaseId,
      requestId,
      proposalId,
      mandate.id,
      intent.offerId,
      intent.merchantId,
      intent.quantity,
      intent.orderAmount.amountMinor,
      intent.orderAmount.currency,
      intent.landedTotal.amountMinor,
      intent.landedTotal.currency,
      auth.via === "APPROVAL" ? approval!.id : null,
      auth.via,
      JSON.stringify(auth.policy),
      iso,
      iso,
    );
    db.prepare(
      `INSERT INTO ledger_entries (id, mandate_id, purchase_id, reserved_minor, amount_minor, currency, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    ).run(
      `led_${randomUUID()}`,
      mandate.id,
      purchaseId,
      auth.policy.worstCaseTotalMinor!,
      auth.policy.worstCaseTotalMinor!,
      mandate.currency,
      iso,
      iso,
    );

    const purchase = getPurchaseByRequestId(db, requestId)!;
    return { ok: true, replay: false, purchase, policy: auth.policy };
  });
}
