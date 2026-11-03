import { connection } from "next/server";
import { z } from "zod";
import { createAgentToken, listAgentTokens } from "@/src/db/agentTokens";
import { handle, json, parseBody } from "@/src/server/http";
import { allow } from "@/src/server/rateLimit";
import { workspace } from "@/src/server/visitor";

export const GET = handle(async () => {
  await connection();
  const { db, mandate } = await workspace();
  return json(listAgentTokens(db, mandate.id));
});

// Issues a mandate token for an outside agent. The plaintext token is returned once and never stored.
export const POST = handle(async (request: Request) => {
  const body = await parseBody(request, z.strictObject({ label: z.string().trim().min(1).max(60) }));
  if (body instanceof Response) return body;
  const { vid, db, mandate } = await workspace();
  if (!allow(`tokens:${vid}`, 10, 60 * 60_000).ok)
    return json({ error: "Too many tokens created. Try again later." }, 429);
  const active = listAgentTokens(db, mandate.id).filter((t) => !t.revokedAt).length;
  if (active >= 5) return json({ error: "You already have 5 active tokens. Revoke one first." }, 400);
  return json(createAgentToken(db, mandate.id, body.label));
});
