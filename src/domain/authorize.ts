// The executor's gate before every charge: re-run policy with fresh data, then check the approval if needed.
// An approval can only unlock NEEDS_APPROVAL; it can never override DENIED (caps, pause, expiry, countries).

import { checkApproval, type ApprovalProblem, type ApprovalRecord } from "./approval";
import type { LedgerEntry } from "./ledger";
import type { Mandate } from "./mandate";
import { evaluate, type PolicyResult, type PurchaseIntent, type ReasonCode } from "./policy";

export type ChargeAuthorization =
  | { allowed: true; via: "AUTO" | "APPROVAL"; policy: PolicyResult }
  | { allowed: false; reasons: (ReasonCode | ApprovalProblem)[]; policy: PolicyResult };

export function authorizeCharge(args: {
  mandate: Mandate;
  ledger: readonly LedgerEntry[];
  intent: PurchaseIntent;
  approval?: ApprovalRecord;
  now: Date;
}): ChargeAuthorization {
  const policy = evaluate(args.mandate, args.ledger, args.intent, args.now);
  if (policy.decision === "DENIED") return { allowed: false, reasons: policy.reasons, policy };
  if (policy.decision === "AUTO") return { allowed: true, via: "AUTO", policy };

  const problems = checkApproval(args.approval, args.intent, args.now);
  return problems.length === 0
    ? { allowed: true, via: "APPROVAL", policy }
    : { allowed: false, reasons: [...policy.reasons, ...problems], policy };
}
