import { connection } from "next/server";
import { handle, json } from "@/src/server/http";
import { workspace } from "@/src/server/visitor";
import { ensureShipments, shipmentsForMandate } from "@/src/shipping/shipments";

export const GET = handle(async () => {
  await connection();
  const { db, mandate } = await workspace();
  await ensureShipments(db, mandate.id, mandate.buyerCountry);
  return json(shipmentsForMandate(db, mandate.id, mandate.buyerCountry));
});
