import { describe, expect, it } from "vitest";
import {
  connectToolkit,
  lookupOrderViaToolkit,
  PayPalToolkitError,
  type PayPalOrderView,
  type ToolkitCaller,
} from "@/src/integrations/paypal/toolkit";
import { compareWithPayPal } from "@/src/server/paypalCheck";

// Shape of a real sandbox get_order response (2026-11-04), payer details removed.
const ORDER = {
  id: "49E82078WM429544M",
  intent: "CAPTURE",
  status: "COMPLETED",
  payment_source: {
    paypal: {
      address: { country_code: "GB" },
      stored_credential: { payment_initiator: "MERCHANT", usage_pattern: "UNSCHEDULED_PREPAID", usage: "SUBSEQUENT" },
    },
  },
  purchase_units: [
    {
      amount: { currency_code: "GBP", value: "18.99" },
      invoice_id: "pur_1",
      payments: {
        captures: [
          {
            id: "5GH055690J589425E",
            status: "COMPLETED",
            amount: { currency_code: "GBP", value: "18.99" },
            seller_protection: { status: "ELIGIBLE" },
            seller_receivable_breakdown: {
              gross_amount: { currency_code: "GBP", value: "18.99" },
              paypal_fee: { currency_code: "GBP", value: "1.34" },
              net_amount: { currency_code: "GBP", value: "17.65" },
            },
          },
        ],
      },
    },
  ],
  create_time: "2026-11-03T07:22:03Z",
};
const TRACKERS = { trackers: [{ tracking_number: "TC6848504830GB", status: "SHIPPED", carrier: "ROYAL_MAIL" }] };

function fakeToolkit(answers: Record<string, unknown>) {
  const seen: { tool: string; args: Record<string, string> }[] = [];
  let closed = false;
  const caller: ToolkitCaller = {
    async call(tool, args) {
      seen.push({ tool, args });
      const a = answers[tool];
      if (a instanceof Error) throw a;
      return a;
    },
    async close() {
      closed = true;
    },
  };
  return { connect: async () => caller, seen, isClosed: () => closed };
}

describe("PayPal Agent Toolkit (in-process MCP server)", () => {
  it("is pinned to the sandbox and exposes only the two read tools", async () => {
    const tk = await connectToolkit(async () => "test-token-not-used");
    await tk.close(); // listing tools needs no network; connectToolkit throws if anything else is exposed
  });

  it("reads PayPal's order and trackers into a view without payer details", async () => {
    const fake = fakeToolkit({ get_order: ORDER, get_shipment_tracking: TRACKERS });
    const v = await lookupOrderViaToolkit("49E82078WM429544M", fake.connect);
    expect(fake.seen).toEqual([
      { tool: "get_order", args: { id: "49E82078WM429544M" } },
      { tool: "get_shipment_tracking", args: { transaction_id: "5GH055690J589425E" } },
    ]);
    expect(v).toMatchObject({
      orderStatus: "COMPLETED",
      amount: { currency: "GBP", value: "18.99" },
      captureStatus: "COMPLETED",
      paypalFee: { currency: "GBP", value: "1.34" },
      paymentInitiator: "MERCHANT",
      trackers: [{ trackingNumber: "TC6848504830GB", status: "SHIPPED" }],
    });
    expect(JSON.stringify(v)).not.toMatch(/email|given_name|payer_id/);
    expect(fake.isClosed()).toBe(true);
  });

  it("rejects malformed ids before calling PayPal, and surfaces toolkit errors", async () => {
    const fake = fakeToolkit({});
    await expect(lookupOrderViaToolkit("../v1/oauth2", fake.connect)).rejects.toThrow(PayPalToolkitError);
    expect(fake.seen).toHaveLength(0);

    const failing = fakeToolkit({ get_order: new PayPalToolkitError("get_order", "RESOURCE_NOT_FOUND") });
    await expect(lookupOrderViaToolkit("49E82078WM429544M", failing.connect)).rejects.toThrow(/RESOURCE_NOT_FOUND/);
    expect(failing.isClosed()).toBe(true);

    const odd = fakeToolkit({ get_order: { id: "x" } });
    await expect(lookupOrderViaToolkit("49E82078WM429544M", odd.connect)).rejects.toThrow(/unexpected order shape/);
  });
});

describe("compareWithPayPal", () => {
  const view = async () =>
    lookupOrderViaToolkit(
      "49E82078WM429544M",
      fakeToolkit({ get_order: ORDER, get_shipment_tracking: TRACKERS }).connect,
    );
  const purchase = {
    id: "pur_1",
    status: "CAPTURED" as const,
    paypalOrderId: "49E82078WM429544M",
    paypalCaptureId: "5GH055690J589425E",
    orderAmountMinor: 1_899,
    orderCurrency: "GBP",
    authorizedVia: "AUTO" as const,
    sellerBreakdown: { paypal_fee: { currency_code: "GBP", value: "1.34" } },
  };

  it("matches a purchase that PayPal recorded the same way", async () => {
    const r = compareWithPayPal(purchase, { trackingNumber: "TC6848504830GB", registered: true }, await view());
    expect(r.allMatch).toBe(true);
    expect(r.rows.filter((x) => x.verdict === "match").map((x) => x.field)).toEqual([
      "Order",
      "Payment status",
      "Amount charged",
      "Capture",
      "Ledger reference (invoice id)",
      "PayPal fee",
      "Tracking",
    ]);
  });

  it("flags every field that disagrees", async () => {
    const v: PayPalOrderView = await view();
    const r = compareWithPayPal(
      { ...purchase, orderAmountMinor: 1_999, status: "PENDING", id: "pur_2" },
      { trackingNumber: "TC0000000000GB", registered: true },
      v,
    );
    expect(r.allMatch).toBe(false);
    expect(r.rows.filter((x) => x.verdict === "mismatch").map((x) => x.field)).toEqual([
      "Payment status",
      "Amount charged",
      "Ledger reference (invoice id)",
      "Tracking",
    ]);
  });

  it("does not call an unregistered tracking number a mismatch", async () => {
    const r = compareWithPayPal(purchase, { trackingNumber: "TC1GB", registered: false }, await view());
    expect(r.rows.find((x) => x.field === "Tracking")).toMatchObject({ verdict: "info" });
  });
});
