import { connection } from "next/server";
import { handle, json } from "@/src/server/http";
import { ledgerView, stateView } from "@/src/server/views";
import { workspace } from "@/src/server/visitor";

export const GET = handle(async () => {
  await connection();
  const { db, mandate } = await workspace();
  return json({ spend: stateView(db, mandate).spend, rows: ledgerView(db, mandate) });
});
