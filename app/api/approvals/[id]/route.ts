import { z } from "zod";
import { getProposal } from "@/src/db/proposals";
import { approveProposal, ProposalStateError, rejectProposal } from "@/src/executor/approvals";
import { paypalGateway } from "@/src/executor/gateway";
import { handle, json, parseBody } from "@/src/server/http";
import { proposalView } from "@/src/server/views";
import { workspace } from "@/src/server/visitor";

// A person approving or rejecting one proposal in their own inbox.
export const POST = handle(async (request: Request, ctx: RouteContext<"/api/approvals/[id]">) => {
  const { id } = await ctx.params;
  const body = await parseBody(request, z.strictObject({ action: z.enum(["approve", "reject"]) }));
  if (body instanceof Response) return body;
  const { db, mandate } = await workspace();
  const proposal = getProposal(db, id);
  if (!proposal || proposal.mandateId !== mandate.id) return json({ error: "Not found." }, 404);
  try {
    if (body.action === "reject") rejectProposal({ db }, id);
    else await approveProposal({ db, gateway: paypalGateway }, id);
  } catch (err) {
    if (err instanceof ProposalStateError) return json({ error: "This request was already handled." }, 409);
    throw err;
  }
  return json(proposalView(getProposal(db, id)!));
});
