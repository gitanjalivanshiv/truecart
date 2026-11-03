import { revokeAgentToken } from "@/src/db/agentTokens";
import { handle, json } from "@/src/server/http";
import { workspace } from "@/src/server/visitor";

export const DELETE = handle(async (_request: Request, ctx: RouteContext<"/api/agent-tokens/[id]">) => {
  const { id } = await ctx.params;
  const { db, mandate } = await workspace();
  return revokeAgentToken(db, id, mandate.id) ? json({ ok: true }) : json({ error: "Not found." }, 404);
});
