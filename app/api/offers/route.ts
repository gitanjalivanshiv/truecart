import { connection } from "next/server";
import { z } from "zod";
import { latestSearch, saveSearch } from "@/src/agent/searchStore";
import { ledgerForMandate } from "@/src/db/repositories";
import { discover, discoveryMode } from "@/src/discovery/discover";
import { rankDiscovery } from "@/src/discovery/rank";
import { brandMaskingEnabled } from "@/src/integrations/channel3/mask";
import { getQuotes } from "@/src/integrations/fxrates/resilient";
import { handle, json, parseBody } from "@/src/server/http";
import { allow, LIMITS } from "@/src/server/rateLimit";
import { searchView } from "@/src/server/views";
import { workspace } from "@/src/server/visitor";

// Latest ranking for this visitor (from the agent or a direct search).
export const GET = handle(async () => {
  await connection();
  const { vid } = await workspace();
  const s = latestSearch(vid);
  return json(s ? searchView(s) : null);
});

// Direct search without the AI model: same discovery, landed-cost and policy engines.
export const POST = handle(async (request: Request) => {
  const body = await parseBody(
    request,
    z.strictObject({ query: z.string().trim().min(2).max(120), quantity: z.number().int().min(1).max(100).default(1) }),
  );
  if (body instanceof Response) return body;
  const { vid, db, mandate } = await workspace();
  const l = LIMITS.searchesPerVisitor;
  if (!allow(`search:${vid}`, l.limit, l.windowMs).ok)
    return json({ error: "Too many searches. Try again in a few minutes." }, 429);
  const mode = discoveryMode();
  const d = await discover(body.query, { mode });
  const fx = await getQuotes(mandate.currency, [...new Set(d.offers.map((o) => o.unitPrice.currency))], { mode });
  const { rows } = rankDiscovery(d, {
    mandate,
    ledger: ledgerForMandate(db, mandate.id),
    quotes: fx.quotes,
    quantity: body.quantity,
    maskBrands: brandMaskingEnabled(),
    now: new Date(),
  });
  const s = saveSearch({
    owner: vid,
    query: body.query,
    quantity: body.quantity,
    rows,
    quotes: fx.quotes,
    fxSource: fx.source,
    markets: d.markets,
    groups: d.groups,
    via: "search",
  });
  return json(searchView(s));
});
