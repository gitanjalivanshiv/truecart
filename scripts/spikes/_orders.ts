// Order helpers shared by S1 (vault charge) and S2 (multi-currency).

import { randomUUID } from "node:crypto";
import { paypalRequest } from "@/src/integrations/paypal/client";

export const DECIMAL = /^\d+(\.\d{1,2})?$/; // spike input only; app code uses integer minor units

export interface CaptureSummary {
  orderId: string;
  orderStatus: string;
  requestId: string;
  captureId?: string;
  captureStatus?: string;
  amount?: unknown;
  seller_receivable_breakdown?: unknown;
  payment_source_keys?: string[];
  vault_attributes?: unknown;
  approveLink?: string;
}

type Order = {
  id: string;
  status: string;
  links?: { rel: string; href: string }[];
  payment_source?: { paypal?: { attributes?: { vault?: unknown } } & Record<string, unknown> };
  purchase_units?: {
    payments?: {
      captures?: { id: string; status: string; amount: unknown; seller_receivable_breakdown?: unknown }[];
    };
  }[];
};

export function summarize(order: Order, requestId: string): CaptureSummary {
  const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderId: order.id,
    orderStatus: order.status,
    requestId,
    captureId: cap?.id,
    captureStatus: cap?.status,
    amount: cap?.amount,
    seller_receivable_breakdown: cap?.seller_receivable_breakdown,
    payment_source_keys: order.payment_source?.paypal ? Object.keys(order.payment_source.paypal) : undefined,
    vault_attributes: order.payment_source?.paypal?.attributes?.vault,
    approveLink: order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href,
  };
}

/** Merchant-initiated charge against a vaulted PayPal wallet. No buyer redirect expected. */
export async function chargeVaulted(opts: {
  vaultId: string;
  currency: string;
  value: string;
  usagePattern?: string;
  storedCredential?: boolean;
  requestId?: string;
  merchantLabel?: string;
}): Promise<{ order: Order; summary: CaptureSummary }> {
  if (!DECIMAL.test(opts.value)) throw new Error(`amount must look like 12.34, got ${opts.value}`);
  const requestId = opts.requestId ?? `spike-${randomUUID()}`;
  const paypal: Record<string, unknown> = { vault_id: opts.vaultId };
  if (opts.storedCredential !== false) {
    paypal.stored_credential = {
      payment_initiator: "MERCHANT",
      usage: "SUBSEQUENT",
      ...(opts.usagePattern ? { usage_pattern: opts.usagePattern } : {}),
    };
  }
  const { data: order } = await paypalRequest<Order>({
    method: "POST",
    path: "/v2/checkout/orders",
    requestId,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: opts.currency, value: opts.value },
          description: `TrueCart sandbox spike - simulated merchant ${opts.merchantLabel ?? "SPIKE"}`,
          custom_id: `spike:${opts.merchantLabel ?? "SPIKE"}`,
        },
      ],
      payment_source: { paypal },
    },
  });

  // Vaulted CAPTURE orders are expected to come back COMPLETED. If PayPal returns APPROVED, capture explicitly.
  if (order.status === "APPROVED") {
    const { data: captured } = await paypalRequest<Order>({
      method: "POST",
      path: `/v2/checkout/orders/${order.id}/capture`,
      requestId: `${requestId}-capture`,
    });
    return { order: captured, summary: summarize(captured, requestId) };
  }
  return { order, summary: summarize(order, requestId) };
}

/** Buyer-approved order (fallback path, needs a browser approval). */
export async function createApprovalOrder(currency: string, value: string, returnUrl: string) {
  const requestId = `spike-${randomUUID()}`;
  const { data: order } = await paypalRequest<Order>({
    method: "POST",
    path: "/v2/checkout/orders",
    requestId,
    body: {
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: currency, value }, custom_id: "spike:approve-path" }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "TrueCart (sandbox)",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: returnUrl,
            cancel_url: returnUrl,
          },
        },
      },
    },
  });
  return summarize(order, requestId);
}

export async function captureOrder(orderId: string) {
  const requestId = `spike-capture-${orderId}`;
  const { data } = await paypalRequest<Order>({
    method: "POST",
    path: `/v2/checkout/orders/${orderId}/capture`,
    requestId,
  });
  return summarize(data, requestId);
}
