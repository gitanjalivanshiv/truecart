import { z } from "zod";
import { fmtMoney, proposePurchase } from "@/src/agent/purchase";
import { findSearch } from "@/src/agent/searchStore";
import { paypalGateway } from "@/src/executor/gateway";
import { handle, json, parseBody } from "@/src/server/http";
import { workspace } from "@/src/server/visitor";

// "Buy within mandate" from the Offers grid. The browser sends ids only; amounts come from the stored ranking.
export const POST = handle(async (request: Request) => {
  const body = await parseBody(
    request,
    z.strictObject({
      searchId: z.string().startsWith("srch_"),
      offerId: z.string().startsWith("off_"),
      quantity: z.number().int().min(1).max(100),
    }),
  );
  if (body instanceof Response) return body;
  const { vid, db, mandate } = await workspace();
  const search = findSearch(vid, body.searchId);
  const row = search?.rows.find((r) => r.offerId === body.offerId);
  if (!search || !row) return json({ error: "That offer is no longer in your results. Search again." }, 404);
  const res = await proposePurchase(
    { db, mandateId: mandate.id, sessionId: `grid:${vid.slice(0, 8)}`, gateway: paypalGateway, now: () => new Date() },
    row,
    search.quotes,
    body.quantity,
  );
  return json({
    status: res.status === "EXECUTED" ? res.outcome.status : res.status,
    proposalId: res.proposalId,
    decision: res.policy.decision,
    reasons: res.policy.reasons,
    landed: fmtMoney(res.cost.total),
    charged: fmtMoney(res.cost.charged),
    ...(res.status === "EXECUTED" && "orderId" in res.outcome && { orderId: res.outcome.orderId }),
    ...(res.status === "EXECUTED" && "code" in res.outcome && { code: res.outcome.code }),
  });
});
