// The executor's only door to PayPal: vaulted, merchant-initiated orders (verified in spike S1).
// An interface so the executor can be tested against a scripted double; production uses paypalGateway.

import { z } from "zod";
import { paypalRequest } from "@/src/integrations/paypal/client";
import { redact } from "@/src/lib/redact";

/** Must match the usage_pattern used when the wallet was vaulted, or PayPal returns 422 (spike S1). */
export const VAULT_USAGE_PATTERN = "UNSCHEDULED_PREPAID";

const Amount = z.object({ currency_code: z.string(), value: z.string() });
const Capture = z.looseObject({
  id: z.string(),
  status: z.string(),
  amount: Amount,
  custom_id: z.string().optional(),
  invoice_id: z.string().optional(),
  seller_receivable_breakdown: z.unknown().optional(),
});
const Order = z.looseObject({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(z.looseObject({ payments: z.looseObject({ captures: z.array(Capture).optional() }).optional() }))
    .optional(),
});

export interface CaptureSnapshot {
  id: string;
  status: string; // COMPLETED | PENDING | DECLINED | FAILED | ...
  amount: { currency_code: string; value: string };
  sellerReceivableBreakdown?: unknown;
}

export interface OrderSnapshot {
  orderId: string;
  orderStatus: string; // COMPLETED | APPROVED | PAYER_ACTION_REQUIRED | ...
  capture?: CaptureSnapshot;
  raw: unknown; // redacted
}

export interface VaultedOrderRequest {
  requestId: string;
  purchaseId: string;
  vaultId: string;
  currency: string;
  value: string; // decimal string from toDecimalString()
  description: string;
}

export interface PayPalGateway {
  createVaultedOrder(req: VaultedOrderRequest): Promise<OrderSnapshot>;
  getOrder(orderId: string): Promise<OrderSnapshot>;
}

export function toSnapshot(data: unknown): OrderSnapshot {
  const order = Order.parse(data);
  const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderId: order.id,
    orderStatus: order.status,
    capture: cap && {
      id: cap.id,
      status: cap.status,
      amount: cap.amount,
      sellerReceivableBreakdown: cap.seller_receivable_breakdown,
    },
    raw: redact(data),
  };
}

export const paypalGateway: PayPalGateway = {
  async createVaultedOrder(req) {
    const { data } = await paypalRequest({
      method: "POST",
      path: "/v2/checkout/orders",
      requestId: req.requestId,
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: { currency_code: req.currency, value: req.value },
            description: req.description.slice(0, 127),
            custom_id: req.purchaseId, // lets webhooks find the purchase
            invoice_id: req.purchaseId, // PayPal-side duplicate guard on top of PayPal-Request-Id
          },
        ],
        payment_source: {
          paypal: {
            vault_id: req.vaultId,
            stored_credential: {
              payment_initiator: "MERCHANT",
              usage: "SUBSEQUENT",
              usage_pattern: VAULT_USAGE_PATTERN,
            },
          },
        },
      },
    });
    const snap = toSnapshot(data);
    // Vaulted CAPTURE orders came back COMPLETED in S1. If PayPal ever returns APPROVED, capture explicitly.
    if (snap.orderStatus === "APPROVED") {
      const { data: captured } = await paypalRequest({
        method: "POST",
        path: `/v2/checkout/orders/${encodeURIComponent(snap.orderId)}/capture`,
        requestId: `${req.requestId}-capture`,
      });
      return toSnapshot(captured);
    }
    return snap;
  },

  async getOrder(orderId) {
    const { data } = await paypalRequest({ method: "GET", path: `/v2/checkout/orders/${encodeURIComponent(orderId)}` });
    return toSnapshot(data);
  },
};
