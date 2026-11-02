// S5 — Webhook receive + signature verification.
//   npm run spike:webhook -- serve [--port 8787] [--simulator]   local receiver at POST /api/webhooks/paypal
//   npm run spike:webhook -- list                                 list webhooks registered on the REST app
//   npm run spike:webhook -- create --url https://<public>/api/webhooks/paypal
//   npm run spike:webhook -- simulate --url https://<public>/api/webhooks/paypal [--event PAYMENT.CAPTURE.COMPLETED]
// Needs a public HTTPS URL (Render deploy or a tunnel such as cloudflared) for PayPal to reach the receiver.
// Simulator mock events: self-verify with webhook id "WEBHOOK_ID"; postback verification is not supported for them.

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { paypalRequest } from "@/src/integrations/paypal/client";
import { postbackVerify, readWebhookHeaders, selfVerify } from "@/src/integrations/paypal/webhooks";
import { arg, requireEnv, run, show } from "./_lib";

const EVENTS = [
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.PENDING",
  "VAULT.PAYMENT-TOKEN.CREATED",
  "VAULT.PAYMENT-TOKEN.DELETED",
  "CUSTOMER.DISPUTE.CREATED",
];

run(async () => {
  const cmd = process.argv[2] ?? "serve";

  if (cmd === "serve") {
    const simulator = process.argv.includes("--simulator");
    if (!simulator) requireEnv("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID");
    const webhookId = simulator ? "WEBHOOK_ID" : process.env.PAYPAL_WEBHOOK_ID!;
    const port = Number(arg("port", "8787"));
    createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/api/webhooks/paypal") return void res.writeHead(404).end();
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks);
      const result: Record<string, unknown> = { at: new Date().toISOString() };
      try {
        const headers = readWebhookHeaders((n) => req.headers[n] as string | undefined);
        const event = JSON.parse(raw.toString("utf8")) as { id?: string; event_type?: string };
        Object.assign(result, {
          eventId: event.id,
          eventType: event.event_type,
          certUrl: headers.certUrl,
          authAlgo: headers.authAlgo,
        });
        result.selfVerified = await selfVerify({ headers, webhookId, rawBody: raw });
        if (!simulator) result.postback = await postbackVerify({ headers, webhookId, rawBody: raw.toString("utf8") });
      } catch (err) {
        result.error = (err as Error).message;
      }
      show("webhook received", result);
      res.writeHead(200).end();
    }).listen(port, () =>
      console.log(`listening on http://localhost:${port}/api/webhooks/paypal (simulator=${simulator})`),
    );
    return;
  }

  requireEnv("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET");
  if (cmd === "list") {
    const { data } = await paypalRequest({ method: "GET", path: "/v1/notifications/webhooks" });
    show("webhooks", data);
  } else if (cmd === "create") {
    const url = arg("url");
    if (!url?.startsWith("https://")) throw new Error("--url https://... required");
    const { data } = await paypalRequest({
      method: "POST",
      path: "/v1/notifications/webhooks",
      requestId: `spike-wh-${randomUUID()}`,
      body: { url, event_types: EVENTS.map((name) => ({ name })) },
    });
    show("webhook created (put its id in PAYPAL_WEBHOOK_ID)", data);
  } else if (cmd === "simulate") {
    const url = arg("url");
    if (!url) throw new Error("--url required");
    const { data } = await paypalRequest({
      method: "POST",
      path: "/v1/notifications/simulate-event",
      requestId: `spike-sim-${randomUUID()}`,
      body: { url, event_type: arg("event", "PAYMENT.CAPTURE.COMPLETED"), resource_version: "2.0" },
    });
    show("simulated event sent", data);
  } else {
    throw new Error(`unknown command ${cmd}`);
  }
});
