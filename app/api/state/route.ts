import { connection } from "next/server";
import { handle, json } from "@/src/server/http";
import { stateView } from "@/src/server/views";
import { workspace } from "@/src/server/visitor";

export const GET = handle(async () => {
  await connection();
  const { db, mandate } = await workspace();
  return json(stateView(db, mandate));
});
