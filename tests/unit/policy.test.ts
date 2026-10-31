import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createApproval, consumeApproval } from "@/src/domain/approval";
import { authorizeCharge } from "@/src/domain/authorize";
import { committedThisMonth, type LedgerEntry } from "@/src/domain/ledger";
import type { Mandate, MandateInput } from "@/src/domain/mandate";
import { money } from "@/src/domain/money";
import { evaluate, type Decision, type PurchaseIntent, type ReasonCode } from "@/src/domain/policy";
import { intent, mandate, NOW } from "./fixtures/domain";

const entry = (amountMinor: number, overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `e-${amountMinor}`,
  mandateId: "mandate-1",
  amountMinor,
  currency: "GBP",
  status: "CAPTURED",
  createdAt: "2026-11-02T09:00:00Z",
  ...overrides,
});

type Case = [string, Partial<MandateInput>, Partial<PurchaseIntent>, Decision, ReasonCode, LedgerEntry[]?];

describe("policy: one row per reason code", () => {
  const cases: Case[] = [
    ["within limits", {}, {}, "AUTO", "WITHIN_LIMITS"],
    ["paused", { paused: true }, {}, "DENIED", "MANDATE_PAUSED"],
    ["expired", { expiresAt: "2026-11-15T12:00:00Z" }, {}, "DENIED", "MANDATE_EXPIRED"],
    ["wallet not linked", { walletTokenRef: null }, {}, "DENIED", "WALLET_NOT_LINKED"],
    ["other mandate", {}, { mandateId: "mandate-2" }, "DENIED", "MANDATE_MISMATCH"],
    ["blank merchant", {}, { merchantId: "  " }, "DENIED", "UNKNOWN_MERCHANT"],
    ["unknown country", {}, { merchantCountry: null }, "DENIED", "MERCHANT_COUNTRY_UNKNOWN"],
    ["malformed country", {}, { merchantCountry: "gb" }, "DENIED", "MERCHANT_COUNTRY_UNKNOWN"],
    ["country not allowed", {}, { merchantCountry: "FR" }, "DENIED", "MERCHANT_COUNTRY_NOT_ALLOWED"],
    ["currency not allowed", {}, { orderAmount: money(3_000, "CHF") }, "DENIED", "ORDER_CURRENCY_NOT_ALLOWED"],
    ["landed in wrong currency", {}, { landedTotal: money(3_000, "USD") }, "DENIED", "LANDED_CURRENCY_MISMATCH"],
    ["zero amount", {}, { orderAmount: money(0, "GBP") }, "DENIED", "INVALID_AMOUNT"],
    ["negative landed", {}, { landedTotal: money(-1, "GBP") }, "DENIED", "INVALID_AMOUNT"],
    ["zero quantity", {}, { quantity: 0 }, "DENIED", "INVALID_QUANTITY"],
    ["fractional quantity", {}, { quantity: 1.5 }, "DENIED", "INVALID_QUANTITY"],
    ["20 units (injection)", {}, { quantity: 20 }, "DENIED", "QUANTITY_EXCEEDS_LIMIT"],
    ["one over the unit limit", {}, { quantity: 4 }, "DENIED", "QUANTITY_EXCEEDS_LIMIT"],
    ["1p over per-purchase cap", {}, { landedTotal: money(15_001, "GBP") }, "DENIED", "EXCEEDS_PER_PURCHASE_CAP"],
    [
      "exactly the per-purchase cap",
      {},
      { landedTotal: money(15_000, "GBP") },
      "NEEDS_APPROVAL",
      "ABOVE_APPROVAL_THRESHOLD",
    ],
    ["exactly the threshold", {}, { landedTotal: money(5_000, "GBP") }, "AUTO", "WITHIN_LIMITS"],
    ["1p over the threshold", {}, { landedTotal: money(5_001, "GBP") }, "NEEDS_APPROVAL", "ABOVE_APPROVAL_THRESHOLD"],
    ["low confidence estimate", {}, { confidence: "low" }, "NEEDS_APPROVAL", "LOW_CONFIDENCE_ESTIMATE"],
    ["monthly cap nearly used", {}, {}, "DENIED", "EXCEEDS_MONTHLY_CAP", [entry(38_000)]],
    ["pending counts against cap", {}, {}, "DENIED", "EXCEEDS_MONTHLY_CAP", [entry(38_000, { status: "PENDING" })]],
    ["failed does not count", {}, {}, "AUTO", "WITHIN_LIMITS", [entry(38_000, { status: "FAILED" })]],
    [
      "last month does not count",
      {},
      {},
      "AUTO",
      "WITHIN_LIMITS",
      [entry(38_000, { createdAt: "2026-10-31T23:59:59Z" })],
    ],
    ["other mandate's spend does not count", {}, {}, "AUTO", "WITHIN_LIMITS", [entry(38_000, { mandateId: "m-x" })]],
  ];

  it.each(cases)("%s", (_name, m, i, decision, reason, ledger = []) => {
    const result = evaluate(mandate(m), ledger, intent(i), NOW);
    expect(result.decision).toBe(decision);
    expect(result.reasons).toContain(reason);
  });

  it("FX slack is applied (CEIL) only to cross-currency orders", () => {
    const usd = (landed: number) =>
      intent({ orderAmount: money(6_000, "USD"), merchantCountry: "US", landedTotal: money(landed, "GBP") });
    // 49.01 + ceil(0.9802) = 50.00 -> AUTO; 49.02 + ceil(0.9804) = 50.01 -> NEEDS_APPROVAL
    expect(evaluate(mandate(), [], usd(4_901), NOW)).toMatchObject({ decision: "AUTO", worstCaseTotalMinor: 5_000 });
    expect(evaluate(mandate(), [], usd(4_902), NOW)).toMatchObject({
      decision: "NEEDS_APPROVAL",
      worstCaseTotalMinor: 5_001,
    });
    expect(evaluate(mandate(), [], intent({ landedTotal: money(4_902, "GBP") }), NOW).worstCaseTotalMinor).toBe(4_902);
  });

  it("reports every applicable reason, not just the first", () => {
    const r = evaluate(mandate({ paused: true }), [], intent({ merchantCountry: "FR", quantity: 20 }), NOW);
    expect(r.reasons).toEqual(
      expect.arrayContaining(["MANDATE_PAUSED", "MERCHANT_COUNTRY_NOT_ALLOWED", "QUANTITY_EXCEEDS_LIMIT"]),
    );
  });

  it("rejects a mandate whose per-purchase cap exceeds its monthly cap", () => {
    expect(() => mandate({ perPurchaseCapMinor: 50_000 })).toThrow();
  });
});

// ---------- property-based tests (fast-check) ----------

const countryArb = fc.constantFrom("GB", "US", "DE", "FR", "CN");
const currencyArb = fc.constantFrom("GBP", "USD", "EUR", "CHF");

const mandateArb = fc
  .record({
    perPurchase: fc.integer({ min: 0, max: 100_000 }),
    extraMonthly: fc.integer({ min: 0, max: 200_000 }),
    threshold: fc.integer({ min: 0, max: 120_000 }),
    slack: fc.integer({ min: 0, max: 2_000 }),
    maxUnits: fc.integer({ min: 1, max: 10 }),
    countries: fc.uniqueArray(countryArb, { minLength: 1 }),
    currencies: fc.uniqueArray(currencyArb, { minLength: 1 }),
    paused: fc.boolean(),
    expired: fc.boolean(),
  })
  .map((r) =>
    mandate({
      perPurchaseCapMinor: r.perPurchase,
      monthlyCapMinor: r.perPurchase + r.extraMonthly,
      approvalThresholdMinor: r.threshold,
      maxFxSlackBps: r.slack,
      maxUnitsPerPurchase: r.maxUnits,
      allowedMerchantCountries: r.countries,
      allowedOrderCurrencies: r.currencies as Mandate["allowedOrderCurrencies"],
      paused: r.paused,
      expiresAt: r.expired ? "2026-11-01T00:00:00Z" : "2026-12-31T23:59:59Z",
    }),
  );

const intentArb = fc
  .record({
    offer: fc.constantFrom("offer-1", "offer-2"),
    merchant: fc.constantFrom("m-1", "m-2", ""),
    country: fc.option(countryArb, { nil: null }),
    orderCurrency: currencyArb,
    order: fc.integer({ min: -10, max: 200_000 }),
    landed: fc.integer({ min: -10, max: 200_000 }),
    quantity: fc.integer({ min: 0, max: 25 }),
    confidence: fc.constantFrom("high", "medium", "low") as fc.Arbitrary<PurchaseIntent["confidence"]>,
  })
  .map((r) =>
    intent({
      offerId: r.offer,
      merchantId: r.merchant,
      merchantCountry: r.country,
      orderAmount: money(r.order, r.orderCurrency),
      landedTotal: money(r.landed, "GBP"),
      quantity: r.quantity,
      confidence: r.confidence,
    }),
  );

const ledgerArb = fc.array(
  fc
    .record({
      amountMinor: fc.integer({ min: 0, max: 60_000 }),
      status: fc.constantFrom("PENDING", "CAPTURED", "FAILED", "VOIDED") as fc.Arbitrary<LedgerEntry["status"]>,
      createdAt: fc.constantFrom("2026-11-01T00:00:00Z", "2026-11-14T10:00:00Z", "2026-10-20T00:00:00Z"),
    })
    .map((e) => ({ id: "e", mandateId: "mandate-1", currency: "GBP" as const, ...e })),
  { maxLength: 6 },
);

const severity: Record<Decision, number> = { AUTO: 0, NEEDS_APPROVAL: 1, DENIED: 2 };

describe("policy properties", () => {
  it("never allows (AUTO or NEEDS_APPROVAL) a worst case above the per-purchase or remaining monthly cap", () => {
    fc.assert(
      fc.property(mandateArb, ledgerArb, intentArb, (m, ledger, i) => {
        const r = evaluate(m, ledger, i, NOW);
        if (r.decision === "DENIED") return;
        expect(r.worstCaseTotalMinor).not.toBeNull();
        expect(r.worstCaseTotalMinor!).toBeLessThanOrEqual(m.perPurchaseCapMinor);
        expect(r.worstCaseTotalMinor!).toBeLessThanOrEqual(r.remainingMonthlyMinor);
      }),
      { numRuns: 2_000 },
    );
  });

  it("never AUTO above the approval threshold or with a low-confidence estimate", () => {
    fc.assert(
      fc.property(mandateArb, ledgerArb, intentArb, (m, ledger, i) => {
        const r = evaluate(m, ledger, i, NOW);
        if (r.decision !== "AUTO") return;
        expect(r.worstCaseTotalMinor!).toBeLessThanOrEqual(m.approvalThresholdMinor);
        expect(i.confidence).not.toBe("low");
      }),
      { numRuns: 2_000 },
    );
  });

  it("paused, expired, disallowed country/currency or too many units always DENY", () => {
    fc.assert(
      fc.property(mandateArb, ledgerArb, intentArb, (m, ledger, i) => {
        const mustDeny =
          m.paused ||
          NOW.getTime() >= Date.parse(m.expiresAt) ||
          i.merchantCountry === null ||
          !m.allowedMerchantCountries.includes(i.merchantCountry) ||
          !m.allowedOrderCurrencies.includes(i.orderAmount.currency) ||
          i.quantity > m.maxUnitsPerPurchase;
        if (mustDeny) expect(evaluate(m, ledger, i, NOW).decision).toBe("DENIED");
      }),
      { numRuns: 2_000 },
    );
  });

  it("raising the landed total never makes the decision more permissive", () => {
    fc.assert(
      fc.property(mandateArb, ledgerArb, intentArb, fc.nat({ max: 50_000 }), (m, ledger, i, bump) => {
        if (i.landedTotal.amountMinor <= 0) return; // invalid amounts are DENIED for a different reason
        const higher = { ...i, landedTotal: money(i.landedTotal.amountMinor + bump, "GBP") };
        const a = evaluate(m, ledger, i, NOW).decision;
        const b = evaluate(m, ledger, higher, NOW).decision;
        expect(severity[b]).toBeGreaterThanOrEqual(severity[a]);
      }),
      { numRuns: 2_000 },
    );
  });

  it("monthly committed spend never exceeds the cap across any sequence of purchases and settlements", () => {
    const step = fc.oneof(
      intentArb.map((i) => ({ kind: "buy" as const, i, approve: true })),
      fc.record({
        kind: fc.constant("settle" as const),
        pick: fc.nat(),
        captureBps: fc.integer({ min: 0, max: 10_000 }),
        fail: fc.boolean(),
      }),
    );
    fc.assert(
      fc.property(
        mandateArb.map((m) => ({ ...m, paused: false, expiresAt: "2026-12-31T23:59:59Z" })),
        fc.array(step, { maxLength: 30 }),
        (m, steps) => {
          const ledger: LedgerEntry[] = [];
          steps.forEach((s, n) => {
            if (s.kind === "buy") {
              const approval = createApproval(s.i, `a-${n}`, NOW);
              const auth = authorizeCharge({ mandate: m, ledger, intent: s.i, approval, now: NOW });
              if (auth.allowed) {
                // Executor reserves the worst case as PENDING before calling PayPal.
                ledger.push({
                  id: `e-${n}`,
                  mandateId: m.id,
                  amountMinor: auth.policy.worstCaseTotalMinor!,
                  currency: "GBP",
                  status: "PENDING",
                  createdAt: NOW.toISOString(),
                });
              }
            } else {
              const pending = ledger.filter((e) => e.status === "PENDING");
              if (pending.length === 0) return;
              const e = pending[s.pick % pending.length];
              // Capture settles at or below the reservation (the executor refuses captures above it).
              if (s.fail) e.status = "FAILED";
              else
                Object.assign(e, {
                  status: "CAPTURED",
                  amountMinor: Math.floor((e.amountMinor * s.captureBps) / 10_000),
                });
            }
            expect(committedThisMonth(ledger, m.id, "GBP", NOW)).toBeLessThanOrEqual(m.monthlyCapMinor);
          });
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("approval properties (cart-bound, single use)", () => {
  // A mandate where everything legal needs approval: threshold 0, generous caps.
  const strict = () =>
    mandate({ approvalThresholdMinor: 0, perPurchaseCapMinor: 1_000_000, monthlyCapMinor: 10_000_000 });
  const validIntent = intentArb.filter((i) => evaluate(strict(), [], i, NOW).decision === "NEEDS_APPROVAL");

  it("a matching, fresh approval unlocks NEEDS_APPROVAL", () => {
    fc.assert(
      fc.property(validIntent, (i) => {
        const auth = authorizeCharge({
          mandate: strict(),
          ledger: [],
          intent: i,
          approval: createApproval(i, "a", NOW),
          now: NOW,
        });
        expect(auth).toMatchObject({ allowed: true, via: "APPROVAL" });
      }),
    );
  });

  it("cannot be replayed once used", () => {
    fc.assert(
      fc.property(validIntent, (i) => {
        const used = consumeApproval(createApproval(i, "a", NOW), NOW);
        const auth = authorizeCharge({ mandate: strict(), ledger: [], intent: i, approval: used, now: NOW });
        expect(auth.allowed).toBe(false);
        expect(() => consumeApproval(used, NOW)).toThrow();
      }),
    );
  });

  it("cannot be reused for a different cart", () => {
    const mutation = fc.constantFrom("offerId", "merchantId", "quantity", "amount", "currency", "mandateId");
    fc.assert(
      fc.property(validIntent, mutation, (i, field) => {
        const approval = createApproval(i, "a", NOW);
        const other: PurchaseIntent = {
          ...i,
          ...(field === "offerId" && { offerId: `${i.offerId}-x` }),
          ...(field === "merchantId" && { merchantId: `${i.merchantId}-x` }),
          ...(field === "quantity" && { quantity: i.quantity === 1 ? 2 : 1 }),
          ...(field === "amount" && { orderAmount: money(i.orderAmount.amountMinor + 1, i.orderAmount.currency) }),
          ...(field === "currency" && {
            orderAmount: money(i.orderAmount.amountMinor, i.orderAmount.currency === "GBP" ? "EUR" : "GBP"),
          }),
          ...(field === "mandateId" && { mandateId: "mandate-2" }),
        };
        expect(authorizeCharge({ mandate: strict(), ledger: [], intent: other, approval, now: NOW }).allowed).toBe(
          false,
        );
      }),
    );
  });

  it("expires", () => {
    fc.assert(
      fc.property(validIntent, fc.integer({ min: 15 * 60 * 1000, max: 30 * 24 * 3600 * 1000 }), (i, later) => {
        const approval = createApproval(i, "a", NOW);
        const auth = authorizeCharge({
          mandate: strict(),
          ledger: [],
          intent: i,
          approval,
          now: new Date(NOW.getTime() + later),
        });
        expect(auth.allowed).toBe(false);
      }),
    );
  });

  it("never overrides a DENIED decision", () => {
    fc.assert(
      fc.property(mandateArb, ledgerArb, intentArb, (m, ledger, i) => {
        if (evaluate(m, ledger, i, NOW).decision !== "DENIED") return;
        const auth = authorizeCharge({
          mandate: m,
          ledger,
          intent: i,
          approval: createApproval(i, "a", NOW),
          now: NOW,
        });
        expect(auth.allowed).toBe(false);
      }),
      { numRuns: 2_000 },
    );
  });
});
