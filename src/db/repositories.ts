// Typed access to the tables. Rows are validated on the way out; JSON columns are parsed, never trusted blindly.

import type { ApprovalRecord } from "@/src/domain/approval";
import type { LedgerEntry, LedgerStatus } from "@/src/domain/ledger";
import { MandateSchema, type Mandate } from "@/src/domain/mandate";
import type { CurrencyCode } from "@/src/domain/money";
import type { Db } from "./database";

// ---------- mandates ----------

export function saveMandate(db: Db, mandate: Mandate, now: Date): void {
  const parsed = MandateSchema.parse(mandate);
  const { walletTokenRef, ...data } = parsed;
  db.prepare(
    `INSERT INTO mandates (id, data, wallet_token_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data, wallet_token_ref = excluded.wallet_token_ref, updated_at = excluded.updated_at`,
  ).run(parsed.id, JSON.stringify(data), walletTokenRef, now.toISOString(), now.toISOString());
}

export function getMandate(db: Db, id: string): Mandate | undefined {
  const row = db.prepare("SELECT data, wallet_token_ref FROM mandates WHERE id = ?").get(id) as
    { data: string; wallet_token_ref: string | null } | undefined;
  if (!row) return undefined;
  return MandateSchema.parse({ ...JSON.parse(row.data), walletTokenRef: row.wallet_token_ref });
}

// ---------- approvals ----------

type ApprovalRow = {
  id: string;
  mandate_id: string;
  offer_id: string;
  merchant_id: string;
  quantity: number;
  amount_minor: number;
  currency: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

const toApproval = (r: ApprovalRow): ApprovalRecord => ({
  id: r.id,
  mandateId: r.mandate_id,
  offerId: r.offer_id,
  merchantId: r.merchant_id,
  quantity: r.quantity,
  amountMinor: r.amount_minor,
  currency: r.currency as CurrencyCode,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  usedAt: r.used_at,
});

export function insertApproval(db: Db, a: ApprovalRecord): void {
  db.prepare(
    `INSERT INTO approvals (id, mandate_id, offer_id, merchant_id, quantity, amount_minor, currency, created_at, expires_at, used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id,
    a.mandateId,
    a.offerId,
    a.merchantId,
    a.quantity,
    a.amountMinor,
    a.currency,
    a.createdAt,
    a.expiresAt,
    a.usedAt,
  );
}

export function getApproval(db: Db, id: string): ApprovalRecord | undefined {
  const row = db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as ApprovalRow | undefined;
  return row && toApproval(row);
}

/** Compare-and-set: marks the approval used only if it is still unused and unexpired. True if this call won. */
export function consumeApproval(db: Db, id: string, now: Date): boolean {
  const iso = now.toISOString();
  return (
    db.prepare("UPDATE approvals SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?").run(iso, id, iso)
      .changes === 1
  );
}

// ---------- ledger ----------

type LedgerRow = {
  id: string;
  mandate_id: string;
  amount_minor: number;
  reserved_minor: number;
  currency: string;
  status: LedgerStatus;
  created_at: string;
};

export function ledgerForMandate(db: Db, mandateId: string): LedgerEntry[] {
  const rows = db
    .prepare("SELECT * FROM ledger_entries WHERE mandate_id = ? ORDER BY created_at")
    .all(mandateId) as LedgerRow[];
  return rows.map((r) => ({
    id: r.id,
    mandateId: r.mandate_id,
    amountMinor: r.amount_minor,
    currency: r.currency as CurrencyCode,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export class LedgerSettlementError extends Error {
  override name = "LedgerSettlementError";
}

/**
 * Settles a PENDING reservation. A capture can never exceed what was reserved (also a CHECK constraint),
 * which is what keeps the monthly cap intact after FX moves.
 */
export function settleLedgerEntry(
  db: Db,
  purchaseId: string,
  outcome: { status: "CAPTURED"; amountMinor: number } | { status: "FAILED" | "VOIDED" },
  now: Date,
): void {
  const amount = outcome.status === "CAPTURED" ? outcome.amountMinor : 0;
  const res = db
    .prepare(
      `UPDATE ledger_entries SET status = ?, amount_minor = ?, updated_at = ?
       WHERE purchase_id = ? AND status = 'PENDING' AND ? <= reserved_minor`,
    )
    .run(outcome.status, amount, now.toISOString(), purchaseId, amount);
  if (res.changes !== 1) {
    throw new LedgerSettlementError(`cannot settle ${purchaseId}: not pending, or amount exceeds the reservation`);
  }
}

// ---------- purchases ----------

export type PurchaseStatus = "RESERVED" | "SUBMITTED" | "PENDING" | "CAPTURED" | "FAILED";

export interface PurchaseRecord {
  id: string;
  requestId: string;
  proposalId: string;
  mandateId: string;
  offerId: string;
  merchantId: string;
  quantity: number;
  orderAmountMinor: number;
  orderCurrency: string;
  landedTotalMinor: number;
  landedCurrency: string;
  approvalId: string | null;
  authorizedVia: "AUTO" | "APPROVAL";
  status: PurchaseStatus;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  captureStatus: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

type PurchaseRow = Record<string, unknown>;

const toPurchase = (r: PurchaseRow): PurchaseRecord => ({
  id: r.id as string,
  requestId: r.request_id as string,
  proposalId: r.proposal_id as string,
  mandateId: r.mandate_id as string,
  offerId: r.offer_id as string,
  merchantId: r.merchant_id as string,
  quantity: r.quantity as number,
  orderAmountMinor: r.order_amount_minor as number,
  orderCurrency: r.order_currency as string,
  landedTotalMinor: r.landed_total_minor as number,
  landedCurrency: r.landed_currency as string,
  approvalId: (r.approval_id as string | null) ?? null,
  authorizedVia: r.authorized_via as "AUTO" | "APPROVAL",
  status: r.status as PurchaseStatus,
  paypalOrderId: (r.paypal_order_id as string | null) ?? null,
  paypalCaptureId: (r.paypal_capture_id as string | null) ?? null,
  captureStatus: (r.capture_status as string | null) ?? null,
  errorCode: (r.error_code as string | null) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export function getPurchaseByRequestId(db: Db, requestId: string): PurchaseRecord | undefined {
  const row = db.prepare("SELECT * FROM purchases WHERE request_id = ?").get(requestId) as PurchaseRow | undefined;
  return row && toPurchase(row);
}

export function getPurchase(db: Db, id: string): PurchaseRecord | undefined {
  const row = db.prepare("SELECT * FROM purchases WHERE id = ?").get(id) as PurchaseRow | undefined;
  return row && toPurchase(row);
}

export function updatePurchase(
  db: Db,
  id: string,
  fields: Partial<{
    status: PurchaseStatus;
    paypalOrderId: string;
    paypalCaptureId: string;
    captureStatus: string;
    sellerBreakdown: unknown;
    paypalResponse: unknown;
    errorCode: string;
    error: unknown;
  }>,
  now: Date,
): void {
  const cols: Record<string, unknown> = {
    status: fields.status,
    paypal_order_id: fields.paypalOrderId,
    paypal_capture_id: fields.paypalCaptureId,
    capture_status: fields.captureStatus,
    seller_breakdown: fields.sellerBreakdown === undefined ? undefined : JSON.stringify(fields.sellerBreakdown),
    paypal_response: fields.paypalResponse === undefined ? undefined : JSON.stringify(fields.paypalResponse),
    error_code: fields.errorCode,
    error: fields.error === undefined ? undefined : JSON.stringify(fields.error),
  };
  const set = Object.entries(cols).filter(([, v]) => v !== undefined);
  const sql = `UPDATE purchases SET ${[...set.map(([k]) => `${k} = ?`), "updated_at = ?"].join(", ")} WHERE id = ?`;
  db.prepare(sql).run(...(set.map(([, v]) => v) as (string | null)[]), now.toISOString(), id);
}

export function purchasesWithStatus(db: Db, statuses: PurchaseStatus[]): PurchaseRecord[] {
  const rows = db
    .prepare(`SELECT * FROM purchases WHERE status IN (${statuses.map(() => "?").join(", ")}) ORDER BY created_at`)
    .all(...statuses) as PurchaseRow[];
  return rows.map(toPurchase);
}

export function getPurchaseByCaptureId(db: Db, captureId: string): PurchaseRecord | undefined {
  const row = db.prepare("SELECT * FROM purchases WHERE paypal_capture_id = ?").get(captureId) as
    PurchaseRow | undefined;
  return row && toPurchase(row);
}

export function getPurchaseByOrderId(db: Db, orderId: string): PurchaseRecord | undefined {
  const row = db.prepare("SELECT * FROM purchases WHERE paypal_order_id = ?").get(orderId) as PurchaseRow | undefined;
  return row && toPurchase(row);
}

/** Unlinks a wallet everywhere it is used (e.g. VAULT.PAYMENT-TOKEN.DELETED). Returns affected mandates. */
export function unlinkWalletToken(db: Db, walletTokenRef: string, now: Date): number {
  return Number(
    db
      .prepare("UPDATE mandates SET wallet_token_ref = NULL, updated_at = ? WHERE wallet_token_ref = ?")
      .run(now.toISOString(), walletTokenRef).changes,
  );
}

export interface WebhookEventInsert {
  id: string;
  eventType: string;
  resourceId: string | null;
  verifiedBy: string;
  payload: string;
}

/** Dedupe: true if this event id is new. */
export function insertWebhookEvent(db: Db, e: WebhookEventInsert, now: Date): boolean {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO webhook_events (id, event_type, resource_id, verified_by, payload, received_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(e.id, e.eventType, e.resourceId, e.verifiedBy, e.payload, now.toISOString()).changes === 1
  );
}

export function markWebhookProcessed(db: Db, id: string, now: Date): void {
  db.prepare("UPDATE webhook_events SET processed_at = ? WHERE id = ?").run(now.toISOString(), id);
}

export function purchasesForMandate(
  db: Db,
  mandateId: string,
): (PurchaseRecord & { sellerBreakdown: unknown; paypalResponse: unknown })[] {
  const rows = db
    .prepare("SELECT * FROM purchases WHERE mandate_id = ? ORDER BY created_at DESC")
    .all(mandateId) as PurchaseRow[];
  return rows.map((r) => ({
    ...toPurchase(r),
    sellerBreakdown: r.seller_breakdown ? JSON.parse(r.seller_breakdown as string) : null,
    paypalResponse: r.paypal_response ? JSON.parse(r.paypal_response as string) : null,
  }));
}

export function webhookEventsForPurchases(
  db: Db,
  purchaseIds: string[],
  captureIds: string[],
): { id: string; eventType: string; receivedAt: string; resourceId: string | null }[] {
  if (purchaseIds.length === 0) return [];
  const rows = db
    .prepare(
      "SELECT id, event_type, received_at, resource_id, payload FROM webhook_events ORDER BY received_at DESC LIMIT 200",
    )
    .all() as { id: string; event_type: string; received_at: string; resource_id: string | null; payload: string }[];
  const ids = new Set(purchaseIds);
  const caps = new Set(captureIds);
  return rows
    .filter((r) => (r.resource_id && caps.has(r.resource_id)) || [...ids].some((id) => r.payload.includes(id)))
    .map((r) => ({ id: r.id, eventType: r.event_type, receivedAt: r.received_at, resourceId: r.resource_id }));
}
