import { beforeEach, describe, expect, it } from "vitest";
import { proposePurchase } from "@/src/agent/purchase";
import { openDatabase, type Db } from "@/src/db/database";
import { listProposals } from "@/src/db/proposals";
import { saveMandate } from "@/src/db/repositories";
import { discover } from "@/src/discovery/discover";
import { demoMandate } from "@/src/discovery/demoMandate";
import { rankDiscovery } from "@/src/discovery/rank";
import { approveProposal } from "@/src/executor/approvals";
import type { PayPalGateway } from "@/src/executor/gateway";
import { getQuotes } from "@/src/integrations/fxrates/resilient";
import { adjustShipment, shipmentsForMandate, type TrackerApi } from "@/src/shipping/shipments";
import { deliveryState } from "@/src/shipping/status";

describe("delivery state (simulated carrier)", () => {
  it.each([
    [0, false, false, "LABEL_CREATED"],
    [1, false, false, "IN_TRANSIT"],
    [4, false, false, "OUT_FOR_DELIVERY"],
    [5, false, false, "DELIVERED"],
    [3, true, false, "IN_TRANSIT"],
    [6, true, false, "AT_CUSTOMS"],
    [8, true, false, "DELIVERED"],
  ])("day %i (cross-border %s, delayed %s) -> %s", (day, crossBorder, delayed, stage) => {
    const expected = crossBorder ? 8 : 5;
    expect(deliveryState({ simDays: day, expectedDays: expected, crossBorder, delayed }).stage).toBe(stage);
  });

  it("a delayed cross-border parcel stalls at customs and becomes overdue after the grace period", () => {
    expect(deliveryState({ simDays: 10, expectedDays: 8, crossBorder: true, delayed: true })).toMatchObject({
      stage: "AT_CUSTOMS",
      overdue: false,
      daysLate: 2,
    });
    expect(deliveryState({ simDays: 11, expectedDays: 8, crossBorder: true, delayed: true })).toMatchObject({
      stage: "AT_CUSTOMS",
      overdue: true,
      daysLate: 3,
    });
  });

  it("a delivered parcel is never overdue", () => {
    expect(deliveryState({ simDays: 20, expectedDays: 5, crossBorder: false, delayed: false })).toMatchObject({
      stage: "DELIVERED",
      overdue: false,
      daysLate: 0,
    });
  });
});

describe("shipping after capture", () => {
  const NOW = new Date("2026-11-15T12:00:00Z");
  let db: Db;
  const tracked: { orderId: string; body: { carrier: string; tracking_number: string; capture_id: string } }[] = [];
  const trackerApi: TrackerApi = {
    async addTracker(orderId, body) {
      tracked.push({ orderId, body });
      return { id: `${body.capture_id}-${body.tracking_number}`, status: "SHIPPED" };
    },
  };
  const gateway: PayPalGateway = {
    async createVaultedOrder(req) {
      return {
        orderId: "ORDER-1",
        orderStatus: "COMPLETED",
        capture: { id: "CAP-1", status: "COMPLETED", amount: { currency_code: req.currency, value: req.value } },
        raw: {},
      };
    },
    async getOrder() {
      throw new Error("unused");
    },
  };
  async function bestRow(quantity = 1) {
    const d = await discover("insulated water bottle 1 litre", { mode: "replay" });
    const fx = await getQuotes("GBP", ["USD", "EUR"], { mode: "replay" });
    const mandate = demoMandate("vault-1", NOW);
    const { rows } = rankDiscovery(d, { mandate, ledger: [], quotes: fx.quotes, quantity, maskBrands: true, now: NOW });
    return { row: rows[0], quotes: fx.quotes };
  }

  beforeEach(() => {
    db = openDatabase(":memory:");
    saveMandate(db, demoMandate("vault-1", NOW), NOW);
    tracked.length = 0;
  });

  it("registers a PayPal tracker with the carrier for the shop's country, once", async () => {
    const { row, quotes } = await bestRow();
    const ctx = { db, mandateId: "demo-mandate", sessionId: "s", gateway, now: () => NOW, trackerApi };
    await proposePurchase(ctx, row, quotes, 1);
    const [s] = shipmentsForMandate(db, "demo-mandate", "GB");
    expect(tracked).toMatchObject([{ orderId: "ORDER-1", body: { carrier: "ROYAL_MAIL", capture_id: "CAP-1" } }]);
    expect(s).toMatchObject({
      carrier: "UK post",
      paypalTrackerId: expect.stringMatching(/^CAP-1-TC\d{10}GB$/),
      state: { stage: "LABEL_CREATED", expectedDays: 2 },
    });
    expect(s.store).toMatch(/^Store GB-\d$/);
  });

  it("also ships purchases paid through the approval inbox", async () => {
    const { row, quotes } = await bestRow(3);
    await proposePurchase(
      { db, mandateId: "demo-mandate", sessionId: "s", gateway, now: () => NOW, trackerApi },
      row,
      quotes,
      3,
    );
    const [p] = listProposals(db);
    expect(p.status).toBe("AWAITING_APPROVAL");
    await approveProposal({ db, gateway, now: () => NOW, trackerApi }, p.id);
    expect(shipmentsForMandate(db, "demo-mandate", "GB")).toHaveLength(1);
  });

  it("a tracking failure is recorded on the shipment and never fails the payment", async () => {
    const { row, quotes } = await bestRow();
    const failing: TrackerApi = {
      addTracker: async () => Promise.reject(new Error("PayPal 422 on POST /v2/checkout/orders/X/track")),
    };
    const res = await proposePurchase(
      { db, mandateId: "demo-mandate", sessionId: "s", gateway, now: () => NOW, trackerApi: failing },
      row,
      quotes,
      1,
    );
    expect(res).toMatchObject({ status: "EXECUTED", outcome: { status: "CAPTURED" } });
    expect(shipmentsForMandate(db, "demo-mandate", "GB")[0]).toMatchObject({
      paypalTrackerId: null,
      paypalError: expect.stringContaining("422"),
    });
  });

  it("time machine: advances, delays and resets only the owner's shipments", async () => {
    const { row, quotes } = await bestRow();
    await proposePurchase(
      { db, mandateId: "demo-mandate", sessionId: "s", gateway, now: () => NOW, trackerApi },
      row,
      quotes,
      1,
    );
    const id = shipmentsForMandate(db, "demo-mandate", "GB")[0].id;
    expect(adjustShipment(db, id, "someone-else", "advance")).toBe(false);
    for (let i = 0; i < 2; i++) adjustShipment(db, id, "demo-mandate", "advance");
    expect(shipmentsForMandate(db, "demo-mandate", "GB")[0].state.stage).toBe("DELIVERED");
    adjustShipment(db, id, "demo-mandate", "reset");
    adjustShipment(db, id, "demo-mandate", "delay");
    for (let i = 0; i < 6; i++) adjustShipment(db, id, "demo-mandate", "advance");
    expect(shipmentsForMandate(db, "demo-mandate", "GB")[0].state).toMatchObject({
      stage: "IN_TRANSIT",
      overdue: true,
    });
  });
});
