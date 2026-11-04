import { connection } from "next/server";
import { handle, json } from "@/src/server/http";
import { checkPurchaseWithPayPal, PurchaseNotFoundError } from "@/src/server/paypalCheck";
import { allow, LIMITS } from "@/src/server/rateLimit";
import { workspace } from "@/src/server/visitor";

// Compares one ledger row with PayPal's own record, read through PayPal's Agent Toolkit. Read-only.
export const GET = handle(async (_request: Request, ctx: RouteContext<"/api/ledger/[id]/paypal">) => {
  await connection();
  const { id } = await ctx.params;
  const { vid, db, mandate } = await workspace();
  const rl = allow(`paypal-check:${vid}`, LIMITS.paypalChecksPerVisitor.limit, LIMITS.paypalChecksPerVisitor.windowMs);
  if (!rl.ok)
    return json({ error: "Too many checks. Try again shortly." }, 429, { "Retry-After": String(rl.retryAfterSec) });
  try {
    return json(await checkPurchaseWithPayPal(db, mandate, id));
  } catch (err) {
    if (err instanceof PurchaseNotFoundError) return json({ error: "No PayPal order for this purchase." }, 404);
    // Toolkit errors, MCP timeouts and token failures all mean the same thing to the user.
    console.error(`[paypal-check] ${(err as Error).name}: ${(err as Error).message}`);
    return json({ error: "PayPal did not answer the check. Try again in a moment." }, 502);
  }
});
