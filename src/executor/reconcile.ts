// Polling fallback for missed webhooks and unknown outcomes (SPEC 5.7). Default age 5 min, well past buy() retries.
// SUBMITTED: re-send with the same PayPal-Request-Id (returns the original order if PayPal got it).
// PENDING:   GET the order and apply its capture status.

import type { Db } from "@/src/db/database";
import { getMandate, purchasesWithStatus } from "@/src/db/repositories";
import { classifyFailure } from "./errors";
import { recordOrder, submit, type BuyOutcome, type ExecutorDeps } from "./executor";

export async function reconcile(deps: ExecutorDeps, opts: { olderThanMs?: number } = {}): Promise<BuyOutcome[]> {
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = now.getTime() - (opts.olderThanMs ?? 5 * 60_000);
  const results: BuyOutcome[] = [];
  const db: Db = deps.db;

  for (const p of purchasesWithStatus(db, ["SUBMITTED", "PENDING"])) {
    if (Date.parse(p.updatedAt) > cutoff) continue;
    if (p.status === "SUBMITTED") {
      results.push(await submit({ ...deps, maxAttempts: 1 }, p, getMandate(db, p.mandateId)?.walletTokenRef ?? null));
    } else if (p.paypalOrderId) {
      try {
        results.push(recordOrder(deps, p, await deps.gateway.getOrder(p.paypalOrderId), false));
      } catch (err) {
        const f = classifyFailure(err);
        results.push({ status: "UNKNOWN", purchaseId: p.id, message: `reconcile: ${f.code}` });
      }
    }
  }
  return results;
}
