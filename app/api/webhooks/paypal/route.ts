import { getDb } from "@/src/db/instance";
import { handlePayPalWebhook } from "@/src/executor/webhooks";

// PayPal webhook receiver. Thin wrapper: all logic (verification, dedupe, settlement) is in src/executor/webhooks.ts.
export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer()); // exact bytes: the signature covers the raw body
  const result = await handlePayPalWebhook(
    getDb(),
    { rawBody, header: (name) => request.headers.get(name) },
    { webhookId: process.env.PAYPAL_WEBHOOK_ID },
  );
  return Response.json(result.body, { status: result.status });
}
