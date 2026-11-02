import { createSetupToken } from "@/src/integrations/paypal/vault";
import { handle, json } from "@/src/server/http";
import { allow, LIMITS } from "@/src/server/rateLimit";
import { workspace } from "@/src/server/visitor";
import { rememberSetup } from "@/src/server/walletLinks";

// Starts linking the visitor's own PayPal SANDBOX wallet. Returns the PayPal approval URL.
export const POST = handle(async () => {
  const { vid } = await workspace();
  const l = LIMITS.walletLinksPerVisitor;
  if (!allow(`wallet:${vid}`, l.limit, l.windowMs).ok)
    return json({ error: "Too many wallet link attempts. Try again later." }, 429);
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const { id, approveUrl } = await createSetupToken(`${base}/api/wallet/return`, `${base}/mandate?wallet=cancelled`);
  rememberSetup(vid, id);
  return json({ approveUrl });
});
