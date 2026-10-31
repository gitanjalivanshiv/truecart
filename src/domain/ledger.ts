// Ledger maths for the monthly cap. Entries are stored in mandate currency.
// PENDING entries reserve the policy's worst-case amount until capture settles them.

import type { CurrencyCode } from "./money";

export type LedgerStatus = "PENDING" | "CAPTURED" | "FAILED" | "VOIDED";

export interface LedgerEntry {
  id: string;
  mandateId: string;
  amountMinor: number;
  currency: CurrencyCode;
  status: LedgerStatus;
  createdAt: string; // ISO
}

const COUNTS_AGAINST_CAP: ReadonlySet<LedgerStatus> = new Set(["PENDING", "CAPTURED"]);

/** Monthly windows are UTC calendar months. */
export function sameUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

/** Captured + pending spend for this mandate in the UTC month containing `now`. */
export function committedThisMonth(
  entries: readonly LedgerEntry[],
  mandateId: string,
  currency: CurrencyCode,
  now: Date,
): number {
  let total = 0;
  for (const e of entries) {
    if (e.mandateId !== mandateId || !COUNTS_AGAINST_CAP.has(e.status)) continue;
    if (!sameUtcMonth(new Date(e.createdAt), now)) continue;
    if (e.currency !== currency) throw new Error(`ledger entry ${e.id} is ${e.currency}, mandate is ${currency}`);
    total += e.amountMinor;
  }
  return total;
}
