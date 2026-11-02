// PayPal webhook handling (SPEC 5.7, rules from spike S5):
// - verify the signature against OUR webhook id (never the simulator's "WEBHOOK_ID");
// - 503 on transient verification errors so PayPal retries; 400 on a bad signature;
// - de-duplicate by event id (PayPal re-delivers);
// - status changes only move forward and only through the same settlement code as the executor.

import { z } from "zod";
import type { Db } from "@/src/db/database";
import { transaction } from "@/src/db/database";
import {
  getPurchase,
  getPurchaseByCaptureId,
  insertWebhookEvent,
  markWebhookProcessed,
  settleLedgerEntry,
  unlinkWalletToken,
  updatePurchase,
} from "@/src/db/repositories";
import {
  readWebhookHeaders,
  selfVerify,
  WebhookVerificationError,
  type WebhookHeaders,
} from "@/src/integrations/paypal/webhooks";

const SIMULATOR_WEBHOOK_ID = "WEBHOOK_ID";

const Event = z.looseObject({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource: z
    .looseObject({ id: z.string().optional(), custom_id: z.string().optional(), status: z.string().optional() })
    .optional(),
});

export type Verifier = (args: { headers: WebhookHeaders; webhookId: string; rawBody: Buffer }) => Promise<boolean>;

export interface WebhookResult {
  status: 200 | 400 | 503;
  body: { ok: boolean; duplicate?: boolean; action?: string; error?: string };
}

export async function handlePayPalWebhook(
  db: Db,
  req: { rawBody: Buffer; header: (name: string) => string | null | undefined },
  opts: { webhookId: string | undefined; verify?: Verifier; now?: () => Date },
): Promise<WebhookResult> {
  const now = opts.now ?? (() => new Date());
  const verify = opts.verify ?? selfVerify;
  if (!opts.webhookId || opts.webhookId === SIMULATOR_WEBHOOK_ID) {
    return { status: 503, body: { ok: false, error: "webhook not configured" } };
  }

  let headers: WebhookHeaders;
  try {
    headers = readWebhookHeaders(req.header);
  } catch {
    return { status: 400, body: { ok: false, error: "missing signature headers" } };
  }

  try {
    if (!(await verify({ headers, webhookId: opts.webhookId, rawBody: req.rawBody }))) {
      return { status: 400, body: { ok: false, error: "invalid signature" } };
    }
  } catch (err) {
    // Hostile cert URL or unsupported algorithm: reject. Anything else (cert fetch timeout): let PayPal retry.
    if (err instanceof WebhookVerificationError && !/cert fetch failed/.test(err.message)) {
      return { status: 400, body: { ok: false, error: "verification rejected" } };
    }
    return { status: 503, body: { ok: false, error: "verification unavailable" } };
  }

  const parsed = Event.safeParse(safeJson(req.rawBody));
  if (!parsed.success) return { status: 400, body: { ok: false, error: "malformed event" } };
  const event = parsed.data;

  const action = transaction(db, () => {
    const fresh = insertWebhookEvent(
      db,
      {
        id: event.id,
        eventType: event.event_type,
        resourceId: event.resource?.id ?? null,
        verifiedBy: "self",
        payload: req.rawBody.toString("utf8"),
      },
      now(),
    );
    if (!fresh) return "duplicate";
    const result = apply(db, event, now());
    markWebhookProcessed(db, event.id, now());
    return result;
  });
  return { status: 200, body: { ok: true, ...(action === "duplicate" ? { duplicate: true } : { action }) } };
}

function apply(db: Db, event: z.infer<typeof Event>, now: Date): string {
  const r = event.resource;
  const purchase =
    (r?.custom_id && getPurchase(db, r.custom_id)) || (r?.id && getPurchaseByCaptureId(db, r.id)) || undefined;

  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      if (!purchase) return "capture-unmatched";
      if (purchase.status === "CAPTURED" || purchase.status === "FAILED") return "noop";
      updatePurchase(db, purchase.id, { status: "CAPTURED", paypalCaptureId: r?.id, captureStatus: "COMPLETED" }, now);
      settleLedgerEntry(db, purchase.id, { status: "CAPTURED", amountMinor: purchase.landedTotalMinor }, now);
      return "captured";
    }
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED": {
      if (!purchase) return "capture-unmatched";
      if (purchase.status === "CAPTURED" || purchase.status === "FAILED") return "noop";
      updatePurchase(db, purchase.id, { status: "FAILED", captureStatus: "DENIED", errorCode: "CAPTURE_DENIED" }, now);
      settleLedgerEntry(db, purchase.id, { status: "FAILED" }, now);
      return "failed";
    }
    case "PAYMENT.CAPTURE.PENDING": {
      if (!purchase || purchase.status !== "SUBMITTED") return "noop";
      updatePurchase(db, purchase.id, { status: "PENDING", paypalCaptureId: r?.id, captureStatus: "PENDING" }, now);
      return "pending";
    }
    case "VAULT.PAYMENT-TOKEN.DELETED":
      return r?.id && unlinkWalletToken(db, r.id, now) > 0 ? "wallet-unlinked" : "noop";
    default:
      return "stored";
  }
}

function safeJson(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return undefined;
  }
}
