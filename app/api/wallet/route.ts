import { z } from "zod";
import { saveMandate } from "@/src/db/repositories";
import { handle, json, parseBody } from "@/src/server/http";
import { stateView } from "@/src/server/views";
import { demoWalletToken, workspace } from "@/src/server/visitor";

// Use the shared sandbox buyer wallet, or unlink the wallet (the agent can then buy nothing).
export const POST = handle(async (request: Request) => {
  const body = await parseBody(request, z.strictObject({ action: z.enum(["use-demo", "unlink"]) }));
  if (body instanceof Response) return body;
  const { db, mandate } = await workspace();
  const token = body.action === "use-demo" ? demoWalletToken() : null;
  if (body.action === "use-demo" && !token)
    return json({ error: "No shared sandbox wallet is configured on this server." }, 400);
  const next = { ...mandate, walletTokenRef: token };
  saveMandate(db, next, new Date());
  return json(stateView(db, next));
});
