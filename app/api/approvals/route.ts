import { connection } from "next/server";
import { proposalsForMandate } from "@/src/db/proposals";
import { handle, json } from "@/src/server/http";
import { proposalView } from "@/src/server/views";
import { workspace } from "@/src/server/visitor";

export const GET = handle(async () => {
  await connection();
  const { db, mandate } = await workspace();
  return json(proposalsForMandate(db, mandate.id).map(proposalView));
});
