import { connection } from "next/server";
import { handle, json } from "@/src/server/http";
import { showcase } from "@/src/server/showcase";

// Recorded example for the Shop page: cheapest price tag vs best landed cost (no model, no Channel3 call).
export const GET = handle(async () => {
  await connection();
  return json(await showcase());
});
