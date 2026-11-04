// The Shop page's opening example: the recorded hero search ranked by the real engines (recorded product
// data and FX snapshot, demo mandate), reduced to "cheapest price tag" vs "best landed cost". Deterministic
// and free: it never calls Channel3 or the AI model.

import { discover } from "@/src/discovery/discover";
import { demoMandate } from "@/src/discovery/demoMandate";
import { rankDiscovery, type RankedRow } from "@/src/discovery/rank";
import { getQuotes } from "@/src/integrations/fxrates/resilient";
import { mv } from "./views";

export const SHOWCASE_QUERY = "insulated water bottle 1 litre";

const pick = (r: RankedRow) => ({
  title: r.display.title,
  store: r.display.merchant,
  market: r.offer.market,
  price: mv(r.offer.unitPrice),
  landed: mv(r.total),
  stickerRank: r.stickerRank,
  trueRank: r.trueRank,
  lines: r.lines.map((l) => ({ kind: l.kind, amount: mv(l.amount), estimate: l.estimate, basis: l.basis })),
});

let cached: ReturnType<typeof build> | null = null;

async function build() {
  const d = await discover(SHOWCASE_QUERY, { mode: "replay" });
  const mandate = demoMandate("showcase");
  const fx = await getQuotes(mandate.currency, [...new Set(d.offers.map((o) => o.unitPrice.currency))], {
    mode: "replay",
  });
  const { rows } = rankDiscovery(d, {
    mandate,
    ledger: [],
    quotes: fx.quotes,
    quantity: 1,
    maskBrands: true,
    now: new Date(),
  });
  const best = rows.find((r) => r.trueRank === 1);
  const sticker = rows.find((r) => r.stickerRank === 1);
  if (!best || !sticker) return null;
  return {
    query: SHOWCASE_QUERY,
    offerCount: rows.length,
    markets: d.markets.filter((m) => m.offerCount > 0).map((m) => m.country),
    best: pick(best),
    cheapestSticker: pick(sticker),
    // Same currency (the mandate's) on both sides; summed here so the browser never does money arithmetic.
    landedGap: mv({ amountMinor: sticker.total.amountMinor - best.total.amountMinor, currency: best.total.currency }),
  };
}

export function showcase() {
  cached ??= build().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}
