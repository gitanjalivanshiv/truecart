import { z } from "zod";
import { handle, json, parseBody } from "@/src/server/http";
import { workspace } from "@/src/server/visitor";
import { adjustShipment } from "@/src/shipping/shipments";

// Demo "time machine": advance simulated days, simulate a delay, or reset. Simulation only; nothing at PayPal changes.
export const POST = handle(async (request: Request, ctx: RouteContext<"/api/shipments/[id]">) => {
  const { id } = await ctx.params;
  const body = await parseBody(request, z.strictObject({ action: z.enum(["advance", "delay", "reset"]) }));
  if (body instanceof Response) return body;
  const { db, mandate } = await workspace();
  return adjustShipment(db, id, mandate.id, body.action) ? json({ ok: true }) : json({ error: "Not found." }, 404);
});
