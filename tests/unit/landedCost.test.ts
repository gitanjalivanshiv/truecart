import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { merchantFee } from "@/src/domain/fees";
import { landedCost, rankOffers, type CostingContext, type OfferForCosting } from "@/src/domain/landedCost";
import { money, type Quote } from "@/src/domain/money";
import { feeTable, importRules, shippingLanes } from "@/src/domain/referenceData";

const q = (from: string, to: string, rate: string): Quote => ({
  from,
  to,
  rate,
  source: "fixture",
  asOf: "2026-10-31",
});

// GB buyer paying from a GBP wallet. Rates are the Frankfurter values recorded in S3 (2026-10-31).
const ctx: CostingContext = {
  buyerCountry: "GB",
  fundingCurrency: "GBP",
  reportingCurrency: "GBP",
  quotes: [q("GBP", "USD", "1.337"), q("GBP", "EUR", "1.1964")],
  importRules,
  shippingLanes,
  fxSpreadBps: 300,
};

const offer = (o: Partial<OfferForCosting>): OfferForCosting => ({
  offerId: "gb",
  merchantId: "m-gb",
  merchantCountry: "GB",
  countrySource: "domain",
  unitPrice: money(2_999, "GBP"),
  quantity: 1,
  ...o,
});

const gb = offer({});
const us = offer({ offerId: "us", merchantId: "m-us", merchantCountry: "US", unitPrice: money(2_999, "USD") });
const de = offer({ offerId: "de", merchantId: "m-de", merchantCountry: "DE", unitPrice: money(2_799, "EUR") });

const linesOf = (c: ReturnType<typeof landedCost>) =>
  Object.fromEntries(c.lines.map((l) => [l.kind, l.amount.amountMinor]));

describe("landedCost (hand-computed, see comments)", () => {
  it("domestic GB offer: item + simulated shipping, no tax or FX", () => {
    const c = landedCost(gb, ctx);
    expect(linesOf(c)).toEqual({ item: 2_999, shipping: 399 });
    expect(c.total).toEqual(money(3_398, "GBP"));
    expect(c.charged).toEqual(money(3_398, "GBP"));
    expect(c.confidence).toBe("medium"); // shipping is simulated
  });

  it("US offer under £135: UK VAT at checkout on item+shipping, plus FX spread", () => {
    // charged USD: 29.99 + 14.99 + 20% x 44.98 (= 9.00) = 53.98
    // in GBP @1.337: item 22.43, shipping 11.21, VAT 6.73, spread 3% x 40.37 = 1.21
    const c = landedCost(us, ctx);
    expect(c.charged).toEqual(money(5_398, "USD"));
    expect(linesOf(c)).toEqual({ item: 2_243, shipping: 1_121, importVat: 673, fxConversion: 121 });
    expect(c.total).toEqual(money(4_158, "GBP"));
  });

  it("DE offer: removes 19% German VAT on export, adds UK VAT, FX spread", () => {
    // item net 27.99 / 1.19 = 23.52 EUR; VAT 20% x (23.52 + 8.99) = 6.50; charged 39.01 EUR
    // in GBP @1.1964: item 23.40, VAT removed -3.74, shipping 7.51, VAT 5.43, spread 3% x 32.61 = 0.98
    const c = landedCost(de, ctx);
    expect(c.charged).toEqual(money(3_901, "EUR"));
    expect(linesOf(c)).toEqual({
      item: 2_340,
      originVatRemoved: -374,
      shipping: 751,
      importVat: 543,
      fxConversion: 98,
    });
    expect(c.total).toEqual(money(3_358, "GBP"));
  });

  it("over £135: VAT paid to the carrier (not charged by PayPal); unknown duty forces low confidence", () => {
    const c = landedCost({ ...us, unitPrice: money(20_000, "USD") }, ctx);
    expect(c.charged).toEqual(money(21_499, "USD")); // no VAT inside the PayPal charge
    expect(c.lines.find((l) => l.kind === "importVat")?.basis).toMatch(/carrier/);
    expect(c.lines.find((l) => l.kind === "importVat")?.original).toEqual(money(4_300, "USD"));
    expect(c.confidence).toBe("low");
    expect(c.warnings.join(" ")).toMatch(/duty/i);
  });

  it("adds a delivery penalty when the mandate values waiting", () => {
    const c = landedCost(gb, { ...ctx, deliveryDayValueMinor: 50 });
    expect(linesOf(c).deliveryPenalty).toBe(100); // 2 days x 50p
    expect(c.total).toEqual(money(3_498, "GBP"));
  });

  it("merchant-stated shipping with a verified rule is high confidence", () => {
    const c = landedCost(offer({ shipping: { amount: money(250, "GBP"), days: 1 } }), ctx);
    expect(c.confidence).toBe("high");
    expect(c.lines.find((l) => l.kind === "shipping")?.estimate).toBe(false);
  });

  it("unknown merchant country: no tax or shipping guess, low confidence, warnings", () => {
    const c = landedCost(offer({ merchantCountry: null, countrySource: "unknown" }), ctx);
    expect(c.confidence).toBe("low");
    expect(Object.keys(linesOf(c))).toEqual(["item"]);
    expect(c.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("country from locale + simulated shipping + unverified rule = low confidence", () => {
    const unverified = importRules.map((r) => (r.id === "US-GB" ? { ...r, verifiedAt: null } : r));
    expect(landedCost({ ...us, countrySource: "locale" }, ctx).confidence).toBe("medium");
    expect(landedCost({ ...us, countrySource: "locale" }, { ...ctx, importRules: unverified }).confidence).toBe("low");
  });

  it("no FX line when the order is in the funding currency", () => {
    expect(landedCost(gb, ctx).lines.some((l) => l.kind === "fxConversion")).toBe(false);
  });
});

describe("rankOffers", () => {
  it("flips the sticker ranking and explains why with code-computed deltas", () => {
    const ranked = rankOffers([gb, us, de].map((o) => landedCost(o, ctx)));
    expect(ranked.map((r) => [r.offerId, r.stickerRank, r.trueRank])).toEqual([
      ["de", 2, 1],
      ["gb", 3, 2],
      ["us", 1, 3],
    ]);
    const deRow = ranked.find((r) => r.offerId === "de")!;
    expect(deRow.vsStickerLeader).toEqual({
      offerId: "us",
      totalDeltaMinor: -800,
      drivers: [
        { kind: "originVatRemoved", deltaMinor: -374 },
        { kind: "shipping", deltaMinor: -370 },
        { kind: "importVat", deltaMinor: -130 },
        { kind: "item", deltaMinor: 97 },
        { kind: "fxConversion", deltaMinor: -23 },
      ],
    });
    expect(ranked.find((r) => r.offerId === "us")!.vsStickerLeader).toBeNull();
  });

  it("is deterministic on ties (offer id)", () => {
    const a = landedCost({ ...gb, offerId: "b" }, ctx);
    const b = landedCost({ ...gb, offerId: "a" }, ctx);
    expect(rankOffers([a, b]).map((r) => r.offerId)).toEqual(["a", "b"]);
  });

  it("returns [] for no offers", () => {
    expect(rankOffers([])).toEqual([]);
  });
});

describe("landedCost properties", () => {
  const offerArb = fc
    .record({
      market: fc.constantFrom(
        { country: "GB", currency: "GBP" },
        { country: "US", currency: "USD" },
        { country: "DE", currency: "EUR" },
      ),
      price: fc.integer({ min: 1, max: 50_000 }),
      quantity: fc.integer({ min: 1, max: 3 }),
    })
    .map(({ market: { country, currency }, price, quantity }) =>
      offer({ offerId: `${country}-${price}`, merchantCountry: country, unitPrice: money(price, currency), quantity }),
    );

  it("total is exactly the sum of its lines; only the VAT-removed line is negative", () => {
    fc.assert(
      fc.property(offerArb, (o) => {
        const c = landedCost(o, ctx);
        expect(c.lines.reduce((s, l) => s + l.amount.amountMinor, 0)).toBe(c.total.amountMinor);
        for (const l of c.lines)
          if (l.kind !== "originVatRemoved") expect(l.amount.amountMinor).toBeGreaterThanOrEqual(0);
        expect(c.total.currency).toBe("GBP");
      }),
    );
  });

  it("charges an FX spread exactly when the order currency differs from the funding currency", () => {
    fc.assert(
      fc.property(offerArb, (o) => {
        const hasFx = landedCost(o, ctx).lines.some((l) => l.kind === "fxConversion");
        expect(hasFx).toBe(o.unitPrice.currency !== "GBP");
      }),
    );
  });

  it("a higher listed price never lowers the landed total (same market)", () => {
    fc.assert(
      fc.property(offerArb, fc.integer({ min: 0, max: 5_000 }), (o, bump) => {
        const higher = { ...o, unitPrice: money(o.unitPrice.amountMinor + bump, o.unitPrice.currency) };
        // Crossing the £135 threshold changes the regime (and confidence), so compare within one regime.
        const a = landedCost(o, ctx);
        const b = landedCost(higher, ctx);
        if (a.confidence === b.confidence) expect(b.total.amountMinor).toBeGreaterThanOrEqual(a.total.amountMinor);
      }),
    );
  });
});

describe("merchantFee (seller side, never in the buyer total)", () => {
  it.each([
    [3_398, "GBP", false, 158], // 3.49% = 118.59 -> 119, + 39
    [3_398, "GBP", true, 209], // + 1.50% = 50.97 -> 51
    [5_398, "USD", true, 318], // 188.39 -> 188, 80.97 -> 81, + 49
  ])("%i %s international=%s -> %i", (amount, currency, intl, total) => {
    expect(merchantFee(money(amount, currency), intl, feeTable.merchant).total.amountMinor).toBe(total);
  });

  it("refuses a currency with no configured fixed fee", () => {
    expect(() => merchantFee(money(100, "JPY"), false, feeTable.merchant)).toThrow();
  });
});
