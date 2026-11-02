import { connection } from "next/server";
import { handle, json } from "@/src/server/http";
import { activityView } from "@/src/server/views";
import { workspace } from "@/src/server/visitor";

export const GET = handle(async () => {
  await connection();
  const { db, mandate } = await workspace();
  return json(activityView(db, mandate));
});
