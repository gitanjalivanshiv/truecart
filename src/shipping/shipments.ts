// Shipments for captured purchases. The simulated merchant "ships" right after capture and registers a real
// PayPal tracker on the order (POST /v2/checkout/orders/{id}/track). Tracking never affects payment: failures
// are recorded on the shipment and shown, not thrown.

import { randomInt, randomUUID } from "node:crypto";
import type { Db } from "@/src/db/database";
import { getPurchase, purchasesForMandate } from "@/src/db/repositories";
import { proposalsForMandate } from "@/src/db/proposals";
import { shippingLanes } from "@/src/domain/referenceData";
import { paypalRequest } from "@/src/integrations/paypal/client";
import { deliveryState, type DeliveryState } from "./status";

/** PayPal carrier enum per origin (from the Orders v2 schema). Shown to people as a generic carrier type. */
const CARRIER: Record<string, { code: string; label: string }> = {
  GB: { code: "ROYAL_MAIL", label: "UK post" },
  US: { code: "USPS", label: "US post" },
  DE: { code: "DHL", label: "German courier" },
};

export interface TrackerApi {
  addTracker(
    orderId: string,
    body: { capture_id: string; tracking_number: string; carrier: string; notify_payer: boolean },
    requestId: string,
  ): Promise<{ id: string; status: string }>;
}

export const paypalTrackerApi: TrackerApi = {
  async addTracker(orderId, body, requestId) {
    // Returns the order (Orders v2 schema); trackers sit under purchase_units[].shipping.trackers, id "<capture>-<tracking>".
    const { data } = await paypalRequest<{
      purchase_units?: { shipping?: { trackers?: { id: string; status: string }[] } }[];
    }>({
      method: "POST",
      path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/track`,
      requestId,
      body,
    });
    const trackers = data.purchase_units?.[0]?.shipping?.trackers ?? [];
    const t = trackers.find((x) => x.id.includes(body.tracking_number)) ?? trackers.at(-1);
    if (!t) throw new Error("PayPal returned no tracker for this order");
    return { id: t.id, status: t.status };
  },
};

type Row = {
  id: string;
  purchase_id: string;
  carrier: string;
  tracking_number: string;
  paypal_tracker_id: string | null;
  paypal_error: string | null;
  origin_country: string | null;
  expected_days: number;
  shipped_at: string;
  sim_days: number;
  sim_delayed: number;
};

export async function shipPurchase(
  db: Db,
  purchaseId: string,
  merchantCountry: string | null,
  buyerCountry: string,
  api: TrackerApi = paypalTrackerApi,
  now = new Date(),
): Promise<void> {
  const p = getPurchase(db, purchaseId);
  if (!p || p.status !== "CAPTURED" || !p.paypalOrderId || !p.paypalCaptureId) return;
  if (db.prepare("SELECT 1 FROM shipments WHERE purchase_id = ?").get(purchaseId)) return;
  const origin = merchantCountry ?? buyerCountry;
  const carrier = CARRIER[origin] ?? { code: "OTHER", label: "Courier" };
  const lane = shippingLanes.find((l) => l.origin === origin && l.destination === buyerCountry);
  const tracking = `TC${String(randomInt(1e9, 1e10))}${origin}`;
  let trackerId: string | null = null;
  let error: string | null = null;
  try {
    const t = await api.addTracker(
      p.paypalOrderId,
      { capture_id: p.paypalCaptureId, tracking_number: tracking, carrier: carrier.code, notify_payer: false },
      `track-${purchaseId}`,
    );
    trackerId = t.id;
  } catch (err) {
    error = (err as Error).message.slice(0, 200);
  }
  db.prepare(
    `INSERT OR IGNORE INTO shipments (id, purchase_id, mandate_id, carrier, tracking_number, paypal_tracker_id, paypal_error, origin_country, expected_days, shipped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `shp_${randomUUID()}`,
    purchaseId,
    p.mandateId,
    carrier.code,
    tracking,
    trackerId,
    error,
    origin,
    lane?.days ?? 5,
    now.toISOString(),
  );
}

export interface ShipmentView {
  id: string;
  purchaseId: string;
  title: string;
  store: string;
  carrier: string;
  trackingNumber: string;
  paypalTrackerId: string | null;
  paypalError: string | null;
  shippedAt: string;
  delayed: boolean;
  state: DeliveryState;
  paypalOrderId: string | null;
}

export function shipmentsForMandate(db: Db, mandateId: string, buyerCountry: string): ShipmentView[] {
  const rows = db
    .prepare("SELECT * FROM shipments WHERE mandate_id = ? ORDER BY shipped_at DESC")
    .all(mandateId) as Row[];
  const purchases = new Map(purchasesForMandate(db, mandateId).map((p) => [p.id, p]));
  const proposals = new Map(proposalsForMandate(db, mandateId, 500).map((p) => [p.id, p]));
  return rows.map((r) => {
    const purchase = purchases.get(r.purchase_id);
    const prop = purchase ? proposals.get(purchase.proposalId) : undefined;
    return {
      id: r.id,
      purchaseId: r.purchase_id,
      title: prop?.display.title ?? "Purchase",
      store: prop?.display.merchant ?? "Store",
      carrier: Object.values(CARRIER).find((c) => c.code === r.carrier)?.label ?? "Courier",
      trackingNumber: r.tracking_number,
      paypalTrackerId: r.paypal_tracker_id,
      paypalError: r.paypal_error,
      shippedAt: r.shipped_at,
      delayed: r.sim_delayed === 1,
      paypalOrderId: purchase?.paypalOrderId ?? null,
      state: deliveryState({
        simDays: r.sim_days,
        expectedDays: r.expected_days,
        crossBorder: (r.origin_country ?? buyerCountry) !== buyerCountry,
        delayed: r.sim_delayed === 1,
      }),
    };
  });
}

/** Time machine controls (demo only). */
/** Ships any captured purchase that has no shipment yet (e.g. captured later by a webhook or reconcile). */
export async function ensureShipments(
  db: Db,
  mandateId: string,
  buyerCountry: string,
  api: TrackerApi = paypalTrackerApi,
): Promise<void> {
  const proposals = new Map(proposalsForMandate(db, mandateId, 500).map((p) => [p.id, p]));
  const shipped = new Set(
    (
      db.prepare("SELECT purchase_id FROM shipments WHERE mandate_id = ?").all(mandateId) as { purchase_id: string }[]
    ).map((r) => r.purchase_id),
  );
  for (const p of purchasesForMandate(db, mandateId)) {
    if (p.status === "CAPTURED" && !shipped.has(p.id))
      await shipPurchase(db, p.id, proposals.get(p.proposalId)?.display.merchantCountry ?? null, buyerCountry, api);
  }
}

export function adjustShipment(db: Db, id: string, mandateId: string, action: "advance" | "delay" | "reset"): boolean {
  const sql =
    action === "advance"
      ? "UPDATE shipments SET sim_days = MIN(sim_days + 1, 30) WHERE id = ? AND mandate_id = ?"
      : action === "delay"
        ? "UPDATE shipments SET sim_delayed = 1 WHERE id = ? AND mandate_id = ?"
        : "UPDATE shipments SET sim_days = 0, sim_delayed = 0 WHERE id = ? AND mandate_id = ?";
  return db.prepare(sql).run(id, mandateId).changes === 1;
}
