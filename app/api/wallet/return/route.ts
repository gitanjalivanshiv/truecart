import { saveMandate } from "@/src/db/repositories";
import { exchangeForPaymentToken, setupTokenStatus } from "@/src/integrations/paypal/vault";
import { handle } from "@/src/server/http";
import { workspace } from "@/src/server/visitor";
import { takeSetup } from "@/src/server/walletLinks";

// PayPal sends the buyer back here after approving. We only trust the setup token we created for this visitor.
export const GET = handle(async (request: Request) => {
  const { vid, db, mandate } = await workspace();
  const base = process.env.APP_BASE_URL ?? new URL(request.url).origin;
  const setupTokenId = takeSetup(vid);
  if (!setupTokenId) return Response.redirect(`${base}/mandate?wallet=expired`, 303);
  if ((await setupTokenStatus(setupTokenId)) !== "APPROVED")
    return Response.redirect(`${base}/mandate?wallet=not-approved`, 303);
  const vaultId = await exchangeForPaymentToken(setupTokenId);
  saveMandate(db, { ...mandate, walletTokenRef: vaultId }, new Date());
  return Response.redirect(`${base}/mandate?wallet=linked`, 303);
});
