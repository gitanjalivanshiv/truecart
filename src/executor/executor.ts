// The ONLY code path that moves money (SPEC 5.6). The agent can propose; only buy() charges.
//
//   reserveCharge (one DB transaction: policy re-check, approval CAS, worst-case reservation)
//   -> mark SUBMITTED -> PayPal vaulted MIT order (retries reuse the same PayPal-Request-Id)
//   -> record the outcome and settle the ledger.
//
// Failure handling:
// - transient (timeout, network, 429, 5xx): retry with the same request id; if still unknown, keep the
//   reservation and return UNKNOWN. reconcile() resolves it later. The buyer is never charged twice.
// - declined / wallet / merchant: purchase FAILED, reservation released.
// - capture PENDING: reservation held until a webhook or reconcile() settles it.

import type { Db } from "@/src/db/database";
import { transaction } from "@/src/db/database";
import { getMandate, getPurchase, settleLedgerEntry, updatePurchase, type PurchaseRecord } from "@/src/db/repositories";
import { reserveCharge } from "@/src/db/reserveCharge";
import type { ApprovalProblem } from "@/src/domain/approval";
import { money, parseDecimal, toDecimalString } from "@/src/domain/money";
import type { PolicyResult, PurchaseIntent, ReasonCode } from "@/src/domain/policy";
import { classifyFailure, type ClassifiedFailure } from "./errors";
import type { OrderSnapshot, PayPalGateway } from "./gateway";

export type BuyOutcome =
  | { status: "CAPTURED"; purchaseId: string; orderId: string; captureId: string; replay: boolean; warnings: string[] }
  | { status: "PENDING"; purchaseId: string; orderId: string | null; replay: boolean; message: string }
  | { status: "DENIED"; reasons: (ReasonCode | ApprovalProblem | string)[]; policy: PolicyResult | null }
  | { status: "FAILED"; purchaseId: string; kind: string; code: string; replay: boolean; message: string }
  | { status: "UNKNOWN"; purchaseId: string; message: string };

export interface ExecutorDeps {
  db: Db;
  gateway: PayPalGateway;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function buy(
  deps: ExecutorDeps,
  args: { proposalId: string; intent: PurchaseIntent; approvalId?: string; merchantLabel?: string },
): Promise<BuyOutcome> {
  const now = deps.now ?? (() => new Date());
  const reserved = reserveCharge(deps.db, {
    proposalId: args.proposalId,
    intent: args.intent,
    approvalId: args.approvalId,
    now: now(),
  });
  if (!reserved.ok) return { status: "DENIED", reasons: reserved.reasons, policy: reserved.policy };

  const purchase = reserved.purchase;
  if (reserved.replay && purchase.status !== "RESERVED" && purchase.status !== "SUBMITTED") {
    return outcomeFromRecord(purchase, true);
  }

  // A reservation that was never submitted is re-checked: pausing or expiry since then stops it.
  const mandate = getMandate(deps.db, purchase.mandateId);
  if (purchase.status === "RESERVED") {
    const blocked = !mandate
      ? "MANDATE_NOT_FOUND"
      : mandate.paused
        ? "MANDATE_PAUSED"
        : now() >= new Date(mandate.expiresAt)
          ? "MANDATE_EXPIRED"
          : !mandate.walletTokenRef
            ? "WALLET_NOT_LINKED"
            : null;
    if (blocked) {
      transaction(deps.db, () => {
        settleLedgerEntry(deps.db, purchase.id, { status: "VOIDED" }, now());
        updatePurchase(deps.db, purchase.id, { status: "FAILED", errorCode: blocked }, now());
      });
      return { status: "DENIED", reasons: [blocked], policy: null };
    }
    updatePurchase(deps.db, purchase.id, { status: "SUBMITTED" }, now());
  }

  return submit(deps, purchase, mandate?.walletTokenRef ?? null, args.merchantLabel);
}

/** Sends (or re-sends, idempotently) the PayPal order for a SUBMITTED purchase and records the result. */
export async function submit(
  deps: ExecutorDeps,
  purchase: PurchaseRecord,
  vaultId: string | null,
  merchantLabel?: string,
): Promise<BuyOutcome> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const maxAttempts = deps.maxAttempts ?? 3;
  if (!vaultId)
    return fail(
      deps,
      purchase,
      { kind: "WALLET", code: "WALLET_NOT_LINKED", message: "No PayPal wallet linked" },
      now(),
    );

  const amount = money(purchase.orderAmountMinor, purchase.orderCurrency);
  let last: ClassifiedFailure | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const snap = await deps.gateway.createVaultedOrder({
        requestId: purchase.requestId,
        purchaseId: purchase.id,
        vaultId,
        currency: amount.currency,
        value: toDecimalString(amount),
        description: `TrueCart sandbox order (simulated merchant: ${merchantLabel ?? purchase.merchantId})`,
      });
      return recordOrder(deps, purchase, snap, false);
    } catch (err) {
      last = classifyFailure(err);
      if (last.kind !== "TRANSIENT") return fail(deps, purchase, last, now());
      if (attempt < maxAttempts) await sleep(250 * 2 ** attempt);
    }
  }
  updatePurchase(deps.db, purchase.id, { errorCode: last?.code ?? "UNKNOWN", error: last }, now());
  return {
    status: "UNKNOWN",
    purchaseId: purchase.id,
    message:
      "PayPal did not confirm the payment yet. The amount stays reserved and we will keep checking; you will not be charged twice.",
  };
}

/** Applies a PayPal order snapshot to a purchase. Used by buy(), reconcile() and the webhook handler. */
export function recordOrder(
  deps: ExecutorDeps,
  purchase: PurchaseRecord,
  snap: OrderSnapshot,
  replay: boolean,
): BuyOutcome {
  const now = (deps.now ?? (() => new Date()))();
  const cap = snap.capture;
  const warnings: string[] = [];

  if (snap.orderStatus === "PAYER_ACTION_REQUIRED") {
    return fail(
      deps,
      purchase,
      { kind: "WALLET", code: "PAYER_ACTION_REQUIRED", message: "PayPal needs the buyer to re-approve the wallet" },
      now,
    );
  }

  if (cap) {
    // The charge must be exactly what was reserved and approved.
    let capturedMinor: number | null = null;
    try {
      capturedMinor = parseDecimal(cap.amount.value, cap.amount.currency_code).amountMinor;
    } catch {
      /* unparseable amount: treated as a mismatch below */
    }
    if (cap.amount.currency_code !== purchase.orderCurrency || capturedMinor !== purchase.orderAmountMinor) {
      warnings.push("CAPTURED_AMOUNT_MISMATCH");
    }
  }

  return transaction(deps.db, () => {
    const current = getPurchase(deps.db, purchase.id)!;
    const base = { paypalOrderId: snap.orderId, paypalResponse: snap.raw };
    if (current.status === "CAPTURED" || current.status === "FAILED") return outcomeFromRecord(current, true);

    if (cap?.status === "COMPLETED") {
      updatePurchase(
        deps.db,
        purchase.id,
        {
          ...base,
          status: "CAPTURED",
          paypalCaptureId: cap.id,
          captureStatus: cap.status,
          sellerBreakdown: cap.sellerReceivableBreakdown,
          ...(warnings.length && { errorCode: warnings[0] }),
        },
        now,
      );
      // The ledger records the landed estimate; it is always <= the worst-case reservation.
      settleLedgerEntry(deps.db, purchase.id, { status: "CAPTURED", amountMinor: purchase.landedTotalMinor }, now);
      return {
        status: "CAPTURED",
        purchaseId: purchase.id,
        orderId: snap.orderId,
        captureId: cap.id,
        replay,
        warnings,
      };
    }
    if (cap && (cap.status === "DECLINED" || cap.status === "FAILED")) {
      updatePurchase(
        deps.db,
        purchase.id,
        {
          ...base,
          status: "FAILED",
          paypalCaptureId: cap.id,
          captureStatus: cap.status,
          errorCode: `CAPTURE_${cap.status}`,
        },
        now,
      );
      settleLedgerEntry(deps.db, purchase.id, { status: "FAILED" }, now);
      return {
        status: "FAILED",
        purchaseId: purchase.id,
        kind: "DECLINED",
        code: `CAPTURE_${cap.status}`,
        replay,
        message: "PayPal declined the capture",
      };
    }
    // PENDING capture, or no capture yet: keep the reservation and wait for a webhook / reconcile().
    updatePurchase(
      deps.db,
      purchase.id,
      { ...base, status: "PENDING", ...(cap && { paypalCaptureId: cap.id, captureStatus: cap.status }) },
      now,
    );
    return {
      status: "PENDING",
      purchaseId: purchase.id,
      orderId: snap.orderId,
      replay,
      message: `PayPal reports ${cap?.status ?? snap.orderStatus}; waiting for confirmation`,
    };
  });
}

function fail(deps: ExecutorDeps, purchase: PurchaseRecord, f: ClassifiedFailure, now: Date): BuyOutcome {
  transaction(deps.db, () => {
    updatePurchase(deps.db, purchase.id, { status: "FAILED", errorCode: f.code, error: f }, now);
    settleLedgerEntry(deps.db, purchase.id, { status: "FAILED" }, now);
  });
  return { status: "FAILED", purchaseId: purchase.id, kind: f.kind, code: f.code, replay: false, message: f.message };
}

function outcomeFromRecord(p: PurchaseRecord, replay: boolean): BuyOutcome {
  switch (p.status) {
    case "CAPTURED":
      return {
        status: "CAPTURED",
        purchaseId: p.id,
        orderId: p.paypalOrderId!,
        captureId: p.paypalCaptureId!,
        replay,
        warnings: p.errorCode ? [p.errorCode] : [],
      };
    case "FAILED":
      return {
        status: "FAILED",
        purchaseId: p.id,
        kind: "RECORDED",
        code: p.errorCode ?? "FAILED",
        replay,
        message: "This purchase already failed",
      };
    case "PENDING":
      return {
        status: "PENDING",
        purchaseId: p.id,
        orderId: p.paypalOrderId,
        replay,
        message: "Waiting for PayPal confirmation",
      };
    default:
      return { status: "UNKNOWN", purchaseId: p.id, message: "Payment in progress" };
  }
}
