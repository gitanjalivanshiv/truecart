import { connection } from "next/server";
import { handle, json } from "@/src/server/http";
import { ledgerTotals, ledgerView, stateView } from "@/src/server/views";
import { workspace } from "@/src/server/visitor";

export const GET = handle(async () => {
  await connection();
  const { db, mandate } = await workspace();
  const rows = ledgerView(db, mandate);
  return json({ spend: stateView(db, mandate).spend, rows, totals: ledgerTotals(rows) });
});
