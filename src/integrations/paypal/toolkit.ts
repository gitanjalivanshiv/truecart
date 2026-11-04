// PayPal's own Agent Toolkit (@paypal/agent-toolkit), run in-process as an MCP server and called through an
// MCP client. TrueCart uses it as an independent, read-only view of what PayPal recorded: the toolkit is
// configured with two read actions only (orders.get, shipment.get), so no write tool even exists here.
// Payments never go through it; they stay on the executor's direct REST path.
//
// PayPal's hosted sandbox MCP server (mcp.sandbox.paypal.com) lists its tools but every call returned
// PAYPAL_API_SETUP_ERROR when tested on 2026-11-04 (docs/SPIKE_RESULTS.md, S6), hence in-process.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/mcp";
import { z } from "zod";
import { assertSandboxUrl } from "@/src/config/sandbox";
import { getAccessToken } from "./client";

/** The only toolkit actions TrueCart enables. Both are reads. */
export const TOOLKIT_ACTIONS = { orders: { get: true }, shipment: { get: true } } as const;
export const TOOLKIT_TOOLS = ["get_order", "get_shipment_tracking"] as const;
const CALL_TIMEOUT_MS = 15_000;
const PAYPAL_ID = /^[A-Z0-9]{17,32}$/;

export class PayPalToolkitError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(`${tool}: ${message}`);
    this.name = "PayPalToolkitError";
  }
}

const MoneyJson = z.object({ currency_code: z.string(), value: z.string() });
const OrderJson = z.object({
  id: z.string(),
  status: z.string(),
  payment_source: z
    .object({
      paypal: z
        .object({
          address: z.object({ country_code: z.string() }).partial().optional(),
          stored_credential: z
            .object({ payment_initiator: z.string(), usage_pattern: z.string() })
            .partial()
            .optional(),
        })
        .optional(),
    })
    .optional(),
  purchase_units: z
    .array(
      z.object({
        amount: MoneyJson,
        invoice_id: z.string().optional(),
        payments: z
          .object({
            captures: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.string(),
                  amount: MoneyJson,
                  seller_protection: z.object({ status: z.string() }).partial().optional(),
                  seller_receivable_breakdown: z
                    .object({ gross_amount: MoneyJson, paypal_fee: MoneyJson, net_amount: MoneyJson })
                    .partial()
                    .optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .min(1),
  create_time: z.string().optional(),
});
const TrackersJson = z.object({
  trackers: z
    .array(
      z.object({
        tracking_number: z.string().optional(),
        status: z.string().optional(),
        carrier: z.string().optional(),
      }),
    )
    .default([]),
});

export interface PayPalMoney {
  currency: string;
  value: string;
}
export interface PayPalOrderView {
  orderId: string;
  orderStatus: string;
  amount: PayPalMoney;
  invoiceId: string | null;
  captureId: string | null;
  captureStatus: string | null;
  paypalFee: PayPalMoney | null;
  net: PayPalMoney | null;
  sellerProtection: string | null;
  paymentInitiator: string | null;
  usagePattern: string | null;
  payerCountry: string | null;
  createdAt: string | null;
  trackers: { trackingNumber: string | null; status: string | null; carrier: string | null }[];
  /** Which toolkit tools answered, and how long each took. */
  calls: { tool: string; ms: number }[];
}

export interface ToolkitCaller {
  call(tool: (typeof TOOLKIT_TOOLS)[number], args: Record<string, string>): Promise<unknown>;
  close(): Promise<void>;
}

/** Starts PayPal's toolkit server in-process (sandbox only, read actions only) and connects a client to it. */
export async function connectToolkit(
  accessToken: () => Promise<string> = async () => (await getAccessToken()).token,
): Promise<ToolkitCaller> {
  const token = await accessToken();
  const server = new PayPalAgentToolkit({
    accessToken: token,
    configuration: { actions: TOOLKIT_ACTIONS, context: { sandbox: true } },
  });
  // The toolkit defaults to production when `sandbox` is missing. Refuse to continue unless it points at the
  // sandbox API (the field is internal; the version is pinned exactly, and a missing field fails closed).
  assertSandboxUrl((server as unknown as { _paypal?: { baseUrl?: string } })._paypal?.baseUrl, "api");

  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "truecart", version: "1.0.0" });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  if (names.join() !== [...TOOLKIT_TOOLS].sort().join()) {
    await client.close();
    throw new PayPalToolkitError("listTools", `unexpected tools exposed: ${names.join(", ")}`);
  }

  return {
    async call(tool, args) {
      const res = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
      const block = (res.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text");
      let body: unknown;
      try {
        body = JSON.parse(block?.text ?? "");
      } catch {
        throw new PayPalToolkitError(tool, "non-JSON response");
      }
      const err = body as { error?: { message?: string }; ok?: boolean; message?: string };
      if (res.isError || err?.error || err?.ok === false) {
        throw new PayPalToolkitError(tool, (err?.error?.message ?? err?.message ?? "call failed").slice(0, 200));
      }
      return body;
    },
    close: () => client.close(),
  };
}

/** PayPal's own record of an order (and its trackers), fetched through the Agent Toolkit. */
export async function lookupOrderViaToolkit(
  orderId: string,
  connect: () => Promise<ToolkitCaller> = connectToolkit,
): Promise<PayPalOrderView> {
  if (!PAYPAL_ID.test(orderId)) throw new PayPalToolkitError("get_order", "invalid order id");
  const toolkit = await connect();
  const calls: PayPalOrderView["calls"] = [];
  const timed = async (tool: (typeof TOOLKIT_TOOLS)[number], args: Record<string, string>) => {
    const t0 = Date.now();
    try {
      return await toolkit.call(tool, args);
    } finally {
      calls.push({ tool, ms: Date.now() - t0 });
    }
  };
  try {
    const parsed = OrderJson.safeParse(await timed("get_order", { id: orderId }));
    if (!parsed.success) throw new PayPalToolkitError("get_order", "unexpected order shape");
    const order = parsed.data;
    const unit = order.purchase_units[0];
    const capture = unit.payments?.captures?.[0];
    const money = (m: z.infer<typeof MoneyJson> | undefined): PayPalMoney | null =>
      m ? { currency: m.currency_code, value: m.value } : null;

    let trackers: PayPalOrderView["trackers"] = [];
    if (capture && PAYPAL_ID.test(capture.id)) {
      const t = TrackersJson.safeParse(await timed("get_shipment_tracking", { transaction_id: capture.id }));
      if (t.success)
        trackers = t.data.trackers.map((x) => ({
          trackingNumber: x.tracking_number ?? null,
          status: x.status ?? null,
          carrier: x.carrier ?? null,
        }));
    }
    const wallet = order.payment_source?.paypal;
    return {
      orderId: order.id,
      orderStatus: order.status,
      amount: { currency: unit.amount.currency_code, value: unit.amount.value },
      invoiceId: unit.invoice_id ?? null,
      captureId: capture?.id ?? null,
      captureStatus: capture?.status ?? null,
      paypalFee: money(capture?.seller_receivable_breakdown?.paypal_fee),
      net: money(capture?.seller_receivable_breakdown?.net_amount),
      sellerProtection: capture?.seller_protection?.status ?? null,
      paymentInitiator: wallet?.stored_credential?.payment_initiator ?? null,
      usagePattern: wallet?.stored_credential?.usage_pattern ?? null,
      payerCountry: wallet?.address?.country_code ?? null,
      createdAt: order.create_time ?? null,
      trackers,
      calls,
    };
  } finally {
    await toolkit.close().catch(() => {});
  }
}
