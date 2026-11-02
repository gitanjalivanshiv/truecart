import { describe, expect, it } from "vitest";
import { discover } from "@/src/discovery/discover";
import { demoMandate } from "@/src/discovery/demoMandate";
import { rankDiscovery } from "@/src/discovery/rank";
import { groupProducts, jaccard, titleTokens } from "@/src/domain/matching";
import { getQuotes } from "@/src/integrations/fxrates/resilient";

describe("groupProducts (fuzzy, cross-market)", () => {
  const o = (offerId: string, market: string, brand: string | null, title: string) => ({
    offerId,
    market,
    brand,
    title,
  });

  it("groups the same branded product across markets", () => {
    const groups = groupProducts([
      o("1", "GB", "Gymshark", "Metal Insulated Straw Bottle 1L"),
      o("2", "US", "Gymshark", "Gymshark Metal Insulated Straw Bottle"),
      o("3", "US", "Takeya", "Actives Insulated Bottle"),
    ]);
    const g = groups.find((x) => x.offerIds.includes("1"))!;
    expect(g).toMatchObject({ offerIds: ["1", "2"], markets: ["GB", "US"], match: "identical-title" });
    expect(groups.find((x) => x.offerIds.includes("3"))?.match).toBe("single");
  });

  it("never groups different brands, even with identical titles", () => {
    expect(
      groupProducts([o("1", "GB", "A", "Insulated Water Bottle"), o("2", "DE", "B", "Insulated Water Bottle")]),
    ).toHaveLength(2);
  });

  it("never groups unbranded offers", () => {
    expect(
      groupProducts([o("1", "GB", null, "Insulated Water Bottle"), o("2", "DE", null, "Insulated Water Bottle")]),
    ).toHaveLength(2);
  });

  it("marks near matches as similar, not identical", () => {
    const g = groupProducts([
      o("1", "GB", "Acme", "Insulated Steel Water Bottle Black"),
      o("2", "DE", "Acme", "Insulated Steel Water Bottle"),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].match).toBe("similar-title");
  });

  it("token helpers ignore brand words, units and filler", () => {
    expect([...titleTokens("The Acme 1L Insulated Bottle 500ml", "Acme")]).toEqual(["insulated", "bottle"]);
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });
});

describe("discover + rank on the recorded hero query (deterministic, no network)", () => {
  const NOW = new Date("2026-11-15T12:00:00Z");

  it("finds offers in all three markets, ranks by landed cost, and applies the mandate", async () => {
    const d = await discover("insulated water bottle 1 litre", { mode: "replay" });
    expect(d.markets.map((m) => [m.country, m.source])).toEqual([
      ["GB", "recorded"],
      ["US", "recorded"],
      ["DE", "recorded"],
    ]);
    expect(d.offers.length).toBeGreaterThan(20);

    const fx = await getQuotes("GBP", ["USD", "EUR"], { mode: "replay" });
    const { rows } = rankDiscovery(d, {
      mandate: demoMandate("w", NOW),
      ledger: [],
      quotes: fx.quotes,
      maskBrands: true,
      now: NOW,
    });
    expect(rows.length).toBe(d.offers.length);
    for (const r of rows) {
      expect(r.lines.reduce((s, l) => s + l.amount.amountMinor, 0)).toBe(r.total.amountMinor);
      expect(r.total.currency).toBe("GBP");
    }
    // The headline: the cheapest sticker is not the cheapest landed.
    const sticker = rows.find((r) => r.stickerRank === 1)!;
    expect(sticker.trueRank).toBeGreaterThan(1);
    // Merchants outside the mandate's countries are denied by default.
    for (const r of rows.filter(
      (x) => x.offer.merchantCountry && !["GB", "US", "DE"].includes(x.offer.merchantCountry),
    )) {
      expect(r.policy.decision).toBe("DENIED");
    }
    // Masked display never shows store domains.
    expect(rows.every((r) => r.display.merchant.startsWith("Store ") && r.display.imageUrl === null)).toBe(true);
  });

  it("one failing market does not sink the others", async () => {
    const d = await discover("insulated water bottle 1 litre", {
      mode: "replay",
      locales: [
        { country: "GB", currency: "GBP", language: "en" },
        { country: "FR", currency: "EUR", language: "fr" },
      ],
    });
    expect(d.markets).toMatchObject([
      { country: "GB", source: "recorded" },
      { country: "FR", source: "failed" },
    ]);
    expect(d.offers.length).toBeGreaterThan(0);
  });
});
