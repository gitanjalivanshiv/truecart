import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/src/db/database";
import { getMandate, getPurchase, insertApproval, ledgerForMandate, saveMandate } from "@/src/db/repositories";
import { createApproval } from "@/src/domain/approval";
import { money } from "@/src/domain/money";
import { buy, type ExecutorDeps } from "@/src/executor/executor";
import type { OrderSnapshot, PayPalGateway, VaultedOrderRequest } from "@/src/executor/gateway";
import { reconcile } from "@/src/executor/reconcile";
import { handlePayPalWebhook } from "@/src/executor/webhooks";
import { PayPalApiError, PayPalTimeoutError } from "@/src/integrations/paypal/client";
import { intent, mandate, NOW } from "./fixtures/domain";

// ---- scripted PayPal double (tests only) ----
type Step = OrderSnapshot | Error;
function scriptedGateway(steps: Step[], orders: Record<string, OrderSnapshot> = {}) {
  const calls: VaultedOrderRequest[] = [];
  const gateway: PayPalGateway = {
    async createVaultedOrder(req) {
      calls.push(req);
      const next = steps.shift();
      if (!next) throw new Error("unexpected PayPal call");
      if (next instanceof Error) throw next;
      return next;
    },
    async getOrder(id) {
      if (!orders[id]) throw new Error(`no order ${id}`);
      return orders[id];
    },
  };
  return { gateway, calls };
}

const completed = (value = "30.00", currency = "GBP", status = "COMPLETED"): OrderSnapshot => ({
  orderId: "ORDER-1",
  orderStatus: status === "COMPLETED" ? "COMPLETED" : "PROCESSING",
  capture: {
    id: "CAP-1",
    status,
    amount: { currency_code: currency, value },
    sellerReceivableBreakdown: { gross_amount: { currency_code: currency, value } },
  },
  raw: { id: "ORDER-1" },
});

let db: Db;
let deps: (g: PayPalGateway) => ExecutorDeps;
beforeEach(() => {
  db = openDatabase(":memory:");
  saveMandate(db, mandate(), NOW);
  deps = (gateway) => ({ db, gateway, now: () => NOW, sleep: async () => {} });
});

const ledger = () => ledgerForMandate(db, "mandate-1");

describe("executor.buy", () => {
  it("AUTO purchase: one PayPal call with the vault token, captured and settled at the landed estimate", async () => {
    const { gateway, calls } = scriptedGateway([completed()]);
    const out = await buy(deps(gateway), { proposalId: "p1", intent: intent() });
    expect(out).toMatchObject({ status: "CAPTURED", orderId: "ORDER-1", captureId: "CAP-1", warnings: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ vaultId: "vault-token-1", currency: "GBP", value: "30.00" });
    expect(calls[0].requestId).toMatch(/^tc-[0-9a-f]{32}$/);
    expect(ledger()).toMatchObject([{ status: "CAPTURED", amountMinor: 3_000 }]);
    expect(getPurchase(db, (out as { purchaseId: string }).purchaseId)?.status).toBe("CAPTURED");
  });

  it("DENIED by policy never calls PayPal", async () => {
    const { gateway, calls } = scriptedGateway([]);
    const out = await buy(deps(gateway), { proposalId: "p1", intent: intent({ quantity: 20 }) });
    expect(out).toMatchObject({ status: "DENIED", reasons: expect.arrayContaining(["QUANTITY_EXCEEDS_LIMIT"]) });
    expect(calls).toHaveLength(0);
    expect(ledger()).toHaveLength(0);
  });

  it("NEEDS_APPROVAL: charges only with a matching approval, and only once", async () => {
    const big = intent({ landedTotal: money(8_000, "GBP"), orderAmount: money(8_000, "GBP") });
    insertApproval(db, createApproval(big, "appr-1", NOW));
    const { gateway, calls } = scriptedGateway([completed("80.00")]);
    expect(await buy(deps(gateway), { proposalId: "p1", intent: big })).toMatchObject({ status: "DENIED" });
    expect(await buy(deps(gateway), { proposalId: "p2", intent: big, approvalId: "appr-1" })).toMatchObject({
      status: "CAPTURED",
    });
    expect(await buy(deps(gateway), { proposalId: "p3", intent: big, approvalId: "appr-1" })).toMatchObject({
      status: "DENIED",
    });
    expect(calls).toHaveLength(1);
  });

  it("replaying a captured proposal returns the record and never calls PayPal again", async () => {
    const { gateway, calls } = scriptedGateway([completed()]);
    await buy(deps(gateway), { proposalId: "p1", intent: intent() });
    expect(await buy(deps(gateway), { proposalId: "p1", intent: intent() })).toMatchObject({
      status: "CAPTURED",
      replay: true,
    });
    expect(calls).toHaveLength(1);
  });

  it("transient failures retry with the SAME PayPal-Request-Id", async () => {
    const { gateway, calls } = scriptedGateway([
      new PayPalTimeoutError("POST", "/v2/checkout/orders", 15_000),
      new PayPalApiError(503, "POST", "/v2/checkout/orders", "dbg", undefined, {}),
      completed(),
    ]);
    expect(await buy(deps(gateway), { proposalId: "p1", intent: intent() })).toMatchObject({ status: "CAPTURED" });
    expect(new Set(calls.map((c) => c.requestId)).size).toBe(1);
    expect(calls).toHaveLength(3);
  });

  it("still unknown after retries: UNKNOWN, reservation held, reconcile later settles it with the same id", async () => {
    const t = () => new PayPalTimeoutError("POST", "/v2/checkout/orders", 15_000);
    const { gateway, calls } = scriptedGateway([t(), t(), t(), completed()]);
    const out = await buy(deps(gateway), { proposalId: "p1", intent: intent() });
    expect(out.status).toBe("UNKNOWN");
    expect(ledger()).toMatchObject([{ status: "PENDING", amountMinor: 3_000 }]);

    const later = new Date(NOW.getTime() + 10 * 60_000);
    const results = await reconcile({ ...deps(gateway), now: () => later });
    expect(results).toMatchObject([{ status: "CAPTURED" }]);
    expect(new Set(calls.map((c) => c.requestId)).size).toBe(1);
    expect(ledger()).toMatchObject([{ status: "CAPTURED" }]);
  });

  it.each([
    ["INSTRUMENT_DECLINED", "DECLINED"],
    ["PAYMENT_DENIED", "DECLINED"],
    ["INVALID_VAULT_ID", "WALLET"],
    ["PAYER_ACTION_REQUIRED", "WALLET"],
    ["PAYEE_ACCOUNT_RESTRICTED", "MERCHANT"],
  ])("terminal error %s -> FAILED (%s), no retry, reservation released", async (issue, kind) => {
    const { gateway, calls } = scriptedGateway([
      new PayPalApiError(422, "POST", "/v2/checkout/orders", "dbg", issue, {}),
    ]);
    expect(await buy(deps(gateway), { proposalId: "p1", intent: intent() })).toMatchObject({
      status: "FAILED",
      kind,
      code: issue,
    });
    expect(calls).toHaveLength(1);
    expect(ledger()).toMatchObject([{ status: "FAILED", amountMinor: 0 }]);
  });

  it("capture PENDING keeps the reservation; reconcile settles it from GET order", async () => {
    const pending = completed("30.00", "GBP", "PENDING");
    const { gateway } = scriptedGateway([pending], { "ORDER-1": completed() });
    expect(await buy(deps(gateway), { proposalId: "p1", intent: intent() })).toMatchObject({ status: "PENDING" });
    expect(ledger()).toMatchObject([{ status: "PENDING" }]);
    const later = new Date(NOW.getTime() + 10 * 60_000);
    expect(await reconcile({ ...deps(gateway), now: () => later })).toMatchObject([{ status: "CAPTURED" }]);
  });

  it("flags a captured amount that differs from the approved amount", async () => {
    const { gateway } = scriptedGateway([completed("31.00")]);
    expect(await buy(deps(gateway), { proposalId: "p1", intent: intent() })).toMatchObject({
      status: "CAPTURED",
      warnings: ["CAPTURED_AMOUNT_MISMATCH"],
    });
  });

  it("a reservation is re-checked before submitting: pausing the mandate stops a stuck RESERVED purchase", async () => {
    // Simulate a crash after reserving but before submitting.
    const { reserveCharge } = await import("@/src/db/reserveCharge");
    reserveCharge(db, { proposalId: "p1", intent: intent(), now: NOW });
    saveMandate(db, { ...getMandate(db, "mandate-1")!, paused: true }, NOW);
    const { gateway, calls } = scriptedGateway([completed()]);
    expect(await buy(deps(gateway), { proposalId: "p1", intent: intent() })).toMatchObject({
      status: "DENIED",
      reasons: ["MANDATE_PAUSED"],
    });
    expect(calls).toHaveLength(0);
    expect(ledger()).toMatchObject([{ status: "VOIDED" }]);
  });
});

describe("webhook handler", () => {
  const headers: Record<string, string> = {
    "paypal-transmission-id": "t1",
    "paypal-transmission-time": "2026-11-15T12:00:00Z",
    "paypal-transmission-sig": "sig",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-auth-algo": "SHA256withRSA",
  };
  const req = (event: object) => ({ rawBody: Buffer.from(JSON.stringify(event)), header: (n: string) => headers[n] });
  const ok = async () => true;

  async function pendingPurchase() {
    const { gateway } = scriptedGateway([completed("30.00", "GBP", "PENDING")]);
    const out = await buy(deps(gateway), { proposalId: "p1", intent: intent() });
    return (out as { purchaseId: string }).purchaseId;
  }

  it("settles a pending purchase on PAYMENT.CAPTURE.COMPLETED, once", async () => {
    const id = await pendingPurchase();
    const event = {
      id: "WH-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "CAP-1", custom_id: id, status: "COMPLETED" },
    };
    expect(await handlePayPalWebhook(db, req(event), { webhookId: "WH-ID", verify: ok, now: () => NOW })).toMatchObject(
      { status: 200, body: { action: "captured" } },
    );
    expect(await handlePayPalWebhook(db, req(event), { webhookId: "WH-ID", verify: ok, now: () => NOW })).toMatchObject(
      { status: 200, body: { duplicate: true } },
    );
    expect(ledger()).toMatchObject([{ status: "CAPTURED" }]);
  });

  it("releases the reservation on PAYMENT.CAPTURE.DENIED", async () => {
    const id = await pendingPurchase();
    const event = { id: "WH-2", event_type: "PAYMENT.CAPTURE.DENIED", resource: { id: "CAP-1", custom_id: id } };
    await handlePayPalWebhook(db, req(event), { webhookId: "WH-ID", verify: ok, now: () => NOW });
    expect(ledger()).toMatchObject([{ status: "FAILED", amountMinor: 0 }]);
  });

  it("unlinks the wallet when PayPal deletes the vault token", async () => {
    const event = { id: "WH-3", event_type: "VAULT.PAYMENT-TOKEN.DELETED", resource: { id: "vault-token-1" } };
    await handlePayPalWebhook(db, req(event), { webhookId: "WH-ID", verify: ok, now: () => NOW });
    expect(getMandate(db, "mandate-1")?.walletTokenRef).toBeNull();
  });

  it("rejects a bad signature (400) and asks PayPal to retry on verifier outage (503)", async () => {
    const event = { id: "WH-4", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} };
    expect((await handlePayPalWebhook(db, req(event), { webhookId: "WH-ID", verify: async () => false })).status).toBe(
      400,
    );
    const outage = async () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    expect((await handlePayPalWebhook(db, req(event), { webhookId: "WH-ID", verify: outage })).status).toBe(503);
  });

  it("never runs with the simulator webhook id or without one", async () => {
    const event = { id: "WH-5", event_type: "PAYMENT.CAPTURE.COMPLETED" };
    expect((await handlePayPalWebhook(db, req(event), { webhookId: "WEBHOOK_ID", verify: ok })).status).toBe(503);
    expect((await handlePayPalWebhook(db, req(event), { webhookId: undefined, verify: ok })).status).toBe(503);
  });

  it("rejects missing signature headers", async () => {
    const r = { rawBody: Buffer.from("{}"), header: () => null };
    expect((await handlePayPalWebhook(db, r, { webhookId: "WH-ID", verify: ok })).status).toBe(400);
  });
});
