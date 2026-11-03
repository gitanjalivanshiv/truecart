// The single "propose a purchase" path, shared by the agent tool and the Offers page.
// Re-prices the offer from our records, evaluates the mandate and then: AUTO -> executor, NEEDS_APPROVAL ->
// approval inbox, DENIED -> recorded with reasons. Nothing here takes amounts from a caller.

import { randomUUID } from "node:crypto";
import type { Db } from "@/src/db/database";
import { finishProposal, insertProposal, type ProposalDisplay } from "@/src/db/proposals";
import { getMandate, ledgerForMandate } from "@/src/db/repositories";
import { landedCost, type LandedCost } from "@/src/domain/landedCost";
import { toDecimalString, type Money, type Quote } from "@/src/domain/money";
import { evaluate, type PolicyResult, type PurchaseIntent } from "@/src/domain/policy";
import { costingContextFor, type RankedRow } from "@/src/discovery/rank";
import { buy, type BuyOutcome } from "@/src/executor/executor";
import type { PayPalGateway } from "@/src/executor/gateway";
import { shipPurchase, type TrackerApi } from "@/src/shipping/shipments";

export const fmtMoney = (m: Money) => `${toDecimalString(m)} ${m.currency}`;

export interface PurchaseContext {
  db: Db;
  mandateId: string;
  sessionId: string;
  gateway: PayPalGateway | null;
  now: () => Date;
  /** Defaults to PayPal's tracking API; tests pass a double. */
  trackerApi?: TrackerApi;
}

export function repriceRow(
  db: Db,
  mandateId: string,
  row: RankedRow,
  quotes: readonly Quote[],
  quantity: number,
): LandedCost {
  const mandate = getMandate(db, mandateId);
  if (!mandate) throw new Error("mandate not found");
  const o = row.offer;
  return landedCost(
    {
      offerId: o.offerId,
      merchantId: o.merchantId,
      merchantCountry: o.merchantCountry,
      countrySource: o.countrySource,
      unitPrice: o.unitPrice,
      quantity,
    },
    costingContextFor(mandate, quotes),
  );
}

export function intentFor(mandateId: string, row: RankedRow, cost: LandedCost, quantity: number): PurchaseIntent {
  return {
    mandateId,
    offerId: row.offer.offerId,
    merchantId: row.offer.merchantId,
    merchantCountry: row.offer.merchantCountry,
    orderAmount: cost.charged,
    landedTotal: cost.total,
    quantity,
    confidence: cost.confidence,
  };
}

export type ProposeResult =
  | { status: "DENIED"; proposalId: string; policy: PolicyResult; cost: LandedCost }
  | { status: "AWAITING_APPROVAL"; proposalId: string; policy: PolicyResult; cost: LandedCost }
  | { status: "DRY_RUN"; proposalId: null; policy: PolicyResult; cost: LandedCost }
  | { status: "EXECUTED"; proposalId: string; policy: PolicyResult; cost: LandedCost; outcome: BuyOutcome };

export async function proposePurchase(
  ctx: PurchaseContext,
  row: RankedRow,
  quotes: readonly Quote[],
  quantity: number,
): Promise<ProposeResult> {
  const now = ctx.now();
  const mandate = getMandate(ctx.db, ctx.mandateId);
  if (!mandate) throw new Error("mandate not found");
  const cost = repriceRow(ctx.db, ctx.mandateId, row, quotes, quantity);
  const intent = intentFor(ctx.mandateId, row, cost, quantity);
  const policy = evaluate(mandate, ledgerForMandate(ctx.db, ctx.mandateId), intent, now);
  const display: ProposalDisplay = {
    title: row.display.title,
    merchant: row.display.merchant,
    merchantCountry: row.offer.merchantCountry,
    price: `${fmtMoney(row.offer.unitPrice)} x ${quantity}`,
    landedTotal: fmtMoney(cost.total),
    lines: cost.lines.map((l) => ({ kind: l.kind, amount: fmtMoney(l.amount), estimate: l.estimate, basis: l.basis })),
    confidence: cost.confidence,
  };
  const id = `prop_${randomUUID()}`;
  const base = {
    id,
    sessionId: ctx.sessionId,
    mandateId: ctx.mandateId,
    offerId: intent.offerId,
    intent,
    display,
    policy,
  };

  if (policy.decision === "DENIED") {
    insertProposal(ctx.db, { ...base, status: "DENIED" }, now);
    return { status: "DENIED", proposalId: id, policy, cost };
  }
  if (policy.decision === "NEEDS_APPROVAL") {
    insertProposal(ctx.db, { ...base, status: "AWAITING_APPROVAL" }, now);
    return { status: "AWAITING_APPROVAL", proposalId: id, policy, cost };
  }
  if (!ctx.gateway) return { status: "DRY_RUN", proposalId: null, policy, cost };

  insertProposal(ctx.db, { ...base, status: "EXECUTING" }, now);
  const outcome = await buy(
    { db: ctx.db, gateway: ctx.gateway, now: ctx.now },
    { proposalId: id, intent, merchantLabel: display.merchant },
  );
  finishProposal(ctx.db, id, outcome.status === "DENIED" ? "DENIED" : "DONE", outcome, ctx.now());
  // The simulated merchant ships and registers a PayPal tracker. Never affects the payment result.
  if (outcome.status === "CAPTURED") {
    await shipPurchase(
      ctx.db,
      outcome.purchaseId,
      row.offer.merchantCountry,
      mandate.buyerCountry,
      ctx.trackerApi,
    ).catch(() => {});
  }
  return { status: "EXECUTED", proposalId: id, policy, cost, outcome };
}
