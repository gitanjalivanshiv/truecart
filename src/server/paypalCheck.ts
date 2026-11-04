// "Check with PayPal": compares TrueCart's ledger record of a purchase with PayPal's own record, fetched
// independently through PayPal's Agent Toolkit (read-only MCP tools). Used by the Ledger page and the agent.

import type { Db } from "@/src/db/database";
import { purchasesForMandate, type PurchaseRecord } from "@/src/db/repositories";
import type { Mandate } from "@/src/domain/mandate";
import { toDecimalString, type Money } from "@/src/domain/money";
import { lookupOrderViaToolkit, type PayPalMoney, type PayPalOrderView } from "@/src/integrations/paypal/toolkit";
import { shipmentsForMandate } from "@/src/shipping/shipments";

export const TOOLKIT_SOURCE = "PayPal Agent Toolkit (MCP tools get_order, get_shipment_tracking)";

export interface CheckRow {
  field: string;
  truecart: string;
  paypal: string;
  verdict: "match" | "mismatch" | "info";
}

type PurchaseLike = Pick<
  PurchaseRecord,
  "id" | "status" | "paypalOrderId" | "paypalCaptureId" | "orderAmountMinor" | "orderCurrency" | "authorizedVia"
> & { sellerBreakdown: unknown };

const money = (m: PayPalMoney | null) => (m ? `${m.value} ${m.currency}` : "none");
const EXPECTED_CAPTURE: Partial<Record<PurchaseRecord["status"], string[]>> = {
  CAPTURED: ["COMPLETED"],
  PENDING: ["PENDING"],
  FAILED: ["DECLINED", "FAILED"],
};

/** `shipment.registered` = TrueCart registered this tracking number with PayPal after the capture. */
export function compareWithPayPal(
  p: PurchaseLike,
  shipment: { trackingNumber: string; registered: boolean } | null,
  v: PayPalOrderView,
) {
  const row = (field: string, truecart: string, paypal: string, same: boolean | null): CheckRow => ({
    field,
    truecart,
    paypal,
    verdict: same === null ? "info" : same ? "match" : "mismatch",
  });
  const charged = `${toDecimalString({ amountMinor: p.orderAmountMinor, currency: p.orderCurrency } as Money)} ${p.orderCurrency}`;
  const ourFee = (p.sellerBreakdown as { paypal_fee?: { currency_code: string; value: string } } | null)?.paypal_fee;
  const ourFeeText = ourFee ? `${ourFee.value} ${ourFee.currency_code}` : "none";
  const paypalTracking = v.trackers.map((t) => t.trackingNumber).filter((x): x is string => Boolean(x));

  const rows: CheckRow[] = [
    row("Order", p.paypalOrderId ?? "none", v.orderId, p.paypalOrderId === v.orderId),
    row(
      "Payment status",
      p.status,
      `${v.orderStatus}${v.captureStatus ? ` / capture ${v.captureStatus}` : ""}`,
      (EXPECTED_CAPTURE[p.status] ?? []).includes(v.captureStatus ?? ""),
    ),
    row("Amount charged", charged, money(v.amount), charged === money(v.amount)),
    row("Capture", p.paypalCaptureId ?? "none", v.captureId ?? "none", p.paypalCaptureId === v.captureId),
    row("Ledger reference (invoice id)", p.id, v.invoiceId ?? "none", p.id === v.invoiceId),
    row("PayPal fee", ourFeeText, money(v.paypalFee), ourFee ? ourFeeText === money(v.paypalFee) : null),
    row(
      "Charged by",
      p.authorizedVia === "AUTO" ? "agent, within the auto-buy limit" : "agent, after your approval",
      [v.paymentInitiator, v.usagePattern].filter(Boolean).join(" · ") || "not stated",
      null,
    ),
    row(
      "Tracking",
      shipment ? `${shipment.trackingNumber}${shipment.registered ? "" : " (not registered with PayPal)"}` : "none",
      paypalTracking.length ? paypalTracking.join(", ") : "none",
      shipment?.registered ? paypalTracking.includes(shipment.trackingNumber) : null,
    ),
    row("Seller protection", "not tracked", v.sellerProtection ?? "not stated", null),
  ];
  return { rows, allMatch: rows.every((r) => r.verdict !== "mismatch") };
}

export class PurchaseNotFoundError extends Error {}

/** Loads a purchase that belongs to this mandate and checks it against PayPal's own record. */
export async function checkPurchaseWithPayPal(
  db: Db,
  mandate: Mandate,
  purchaseId: string,
  lookup: (orderId: string) => Promise<PayPalOrderView> = (id) => lookupOrderViaToolkit(id),
) {
  const purchase = purchasesForMandate(db, mandate.id).find((p) => p.id === purchaseId);
  if (!purchase || !purchase.paypalOrderId) throw new PurchaseNotFoundError("no PayPal order for this purchase");
  const ship = shipmentsForMandate(db, mandate.id, mandate.buyerCountry).find((s) => s.purchaseId === purchase.id);
  const shipment = ship ? { trackingNumber: ship.trackingNumber, registered: ship.paypalTrackerId !== null } : null;
  const view = await lookup(purchase.paypalOrderId);
  return {
    purchaseId: purchase.id,
    source: TOOLKIT_SOURCE,
    calls: view.calls,
    ...compareWithPayPal(purchase, shipment, view),
  };
}
