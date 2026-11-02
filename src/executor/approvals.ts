// The human side of NEEDS_APPROVAL. Approving executes exactly the stored intent (the cart the person saw);
// the executor still re-runs the policy, so a cap used up in the meantime still blocks the charge.

import { randomUUID } from "node:crypto";
import { insertApproval } from "@/src/db/repositories";
import { finishProposal, getProposal, transitionProposal } from "@/src/db/proposals";
import { createApproval } from "@/src/domain/approval";
import { buy, type BuyOutcome, type ExecutorDeps } from "./executor";

export class ProposalStateError extends Error {
  override name = "ProposalStateError";
}

export async function approveProposal(deps: ExecutorDeps, proposalId: string): Promise<BuyOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const proposal = getProposal(deps.db, proposalId);
  if (!proposal) throw new ProposalStateError("proposal not found");
  // Compare-and-set: a double click (or two tabs) cannot run the same approval twice.
  if (!transitionProposal(deps.db, proposalId, ["AWAITING_APPROVAL"], "EXECUTING", now)) {
    throw new ProposalStateError(`proposal is ${proposal.status}, not awaiting approval`);
  }
  const approval = createApproval(proposal.intent, `appr_${randomUUID()}`, now);
  insertApproval(deps.db, approval);
  const outcome = await buy(deps, {
    proposalId,
    intent: proposal.intent,
    approvalId: approval.id,
    merchantLabel: proposal.display.merchant,
  });
  finishProposal(
    deps.db,
    proposalId,
    outcome.status === "DENIED" ? "DENIED" : "DONE",
    outcome,
    (deps.now ?? (() => new Date()))(),
  );
  return outcome;
}

export function rejectProposal(deps: Pick<ExecutorDeps, "db" | "now">, proposalId: string): void {
  const now = (deps.now ?? (() => new Date()))();
  if (!transitionProposal(deps.db, proposalId, ["AWAITING_APPROVAL"], "REJECTED", now)) {
    throw new ProposalStateError("proposal is not awaiting approval");
  }
}
