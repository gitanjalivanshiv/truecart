// Discovery: one query -> normalized offers from several markets, plus fuzzy cross-market product groups.
// Markets run in parallel; one failing market does not sink the others (it becomes a warning).

import { groupProducts, type ProductGroup } from "@/src/domain/matching";
import { cachedSearch, type DiscoverySource } from "@/src/integrations/channel3/cache";
import { DEFAULT_LOCALES, type Locale } from "@/src/integrations/channel3/client";
import { normalizeProducts, type DroppedOffer, type NormalizedOffer } from "@/src/integrations/channel3/normalize";

export interface MarketResult {
  country: string;
  source: DiscoverySource | "failed";
  recordedAt: string | null;
  offerCount: number;
  note?: string;
}

export interface Discovery {
  query: string;
  offers: NormalizedOffer[];
  dropped: DroppedOffer[];
  groups: ProductGroup[];
  markets: MarketResult[];
}

export function discoveryMode(env: NodeJS.ProcessEnv = process.env): "live" | "replay" {
  return env.DEMO_MODE === "true" ? "replay" : "live";
}

export async function discover(
  query: string,
  opts: { locales?: Locale[]; limit?: number; mode?: "live" | "replay" } = {},
): Promise<Discovery> {
  const locales = opts.locales ?? DEFAULT_LOCALES;
  const limit = opts.limit ?? 10;
  const mode = opts.mode ?? discoveryMode();

  const settled = await Promise.allSettled(locales.map((config) => cachedSearch({ query, limit, config }, { mode })));
  const offers: NormalizedOffer[] = [];
  const dropped: DroppedOffer[] = [];
  const markets: MarketResult[] = [];

  settled.forEach((r, i) => {
    const locale = locales[i];
    if (r.status === "rejected") {
      markets.push({
        country: locale.country,
        source: "failed",
        recordedAt: null,
        offerCount: 0,
        note: (r.reason as Error).message,
      });
      return;
    }
    const norm = normalizeProducts(r.value.response.products, locale);
    offers.push(...norm.offers);
    dropped.push(...norm.dropped);
    const note =
      r.value.fallbackReason ??
      (r.value.closestRecordedQuery && `closest recorded query: "${r.value.closestRecordedQuery}"`);
    markets.push({
      country: locale.country,
      source: r.value.source,
      recordedAt: r.value.recordedAt,
      offerCount: norm.offers.length,
      ...(note && { note }),
    });
  });

  const unique = [...new Map(offers.map((o) => [o.offerId, o])).values()];
  return { query, offers: unique, dropped, groups: groupProducts(unique), markets };
}
