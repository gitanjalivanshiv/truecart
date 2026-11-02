// Purchase proposals created by the agent. AUTO ones execute immediately; NEEDS_APPROVAL ones wait in the
// approval inbox for a human. The intent is fixed at proposal time and is exactly what the approval binds.

import type { BuyOutcome } from "@/src/executor/executor";
import type { PolicyResult, PurchaseIntent } from "@/src/domain/policy";
import type { Db } from "./database";

export type ProposalStatus = "AWAITING_APPROVAL" | "EXECUTING" | "DONE" | "REJECTED" | "DENIED";

export interface ProposalDisplay {
  title: string;
  merchant: string;
  merchantCountry: string | null;
  price: string;
  landedTotal: string;
  lines: { kind: string; amount: string; estimate: boolean; basis: string }[];
  confidence: string;
}

export interface Proposal {
  id: string;
  sessionId: string;
  mandateId: string;
  offerId: string;
  intent: PurchaseIntent;
  display: ProposalDisplay;
  policy: PolicyResult;
  status: ProposalStatus;
  purchaseId: string | null;
  outcome: BuyOutcome | null;
  createdAt: string;
}

type Row = Record<string, string | null>;
const toProposal = (r: Row): Proposal => ({
  id: r.id!,
  sessionId: r.session_id!,
  mandateId: r.mandate_id!,
  offerId: r.offer_id!,
  intent: JSON.parse(r.intent!),
  display: JSON.parse(r.display!),
  policy: JSON.parse(r.policy!),
  status: r.status as ProposalStatus,
  purchaseId: r.purchase_id,
  outcome: r.outcome ? JSON.parse(r.outcome) : null,
  createdAt: r.created_at!,
});

export function insertProposal(db: Db, p: Omit<Proposal, "purchaseId" | "outcome" | "createdAt">, now: Date): void {
  const iso = now.toISOString();
  db.prepare(
    `INSERT INTO proposals (id, session_id, mandate_id, offer_id, intent, display, policy, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.id,
    p.sessionId,
    p.mandateId,
    p.offerId,
    JSON.stringify(p.intent),
    JSON.stringify(p.display),
    JSON.stringify(p.policy),
    p.status,
    iso,
    iso,
  );
}

export function getProposal(db: Db, id: string): Proposal | undefined {
  const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(id) as Row | undefined;
  return row && toProposal(row);
}

export function listProposals(db: Db, status?: ProposalStatus): Proposal[] {
  const rows = (
    status
      ? db.prepare("SELECT * FROM proposals WHERE status = ? ORDER BY created_at DESC").all(status)
      : db.prepare("SELECT * FROM proposals ORDER BY created_at DESC").all()
  ) as Row[];
  return rows.map(toProposal);
}

/** Compare-and-set status transition. True if this call made the transition. */
export function transitionProposal(db: Db, id: string, from: ProposalStatus[], to: ProposalStatus, now: Date): boolean {
  return (
    db
      .prepare(
        `UPDATE proposals SET status = ?, updated_at = ? WHERE id = ? AND status IN (${from.map(() => "?").join(", ")})`,
      )
      .run(to, now.toISOString(), id, ...from).changes === 1
  );
}

export function finishProposal(db: Db, id: string, status: ProposalStatus, outcome: BuyOutcome, now: Date): void {
  const purchaseId = "purchaseId" in outcome ? outcome.purchaseId : null;
  db.prepare("UPDATE proposals SET status = ?, outcome = ?, purchase_id = ?, updated_at = ? WHERE id = ?").run(
    status,
    JSON.stringify(outcome),
    purchaseId,
    now.toISOString(),
    id,
  );
}
