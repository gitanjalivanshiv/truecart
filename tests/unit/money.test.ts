import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyBps,
  convert,
  divRound,
  MissingQuoteError,
  money,
  MoneyError,
  parseDecimal,
  removeIncludedBps,
  sum,
  toDecimalString,
  type Quote,
  type Rounding,
} from "@/src/domain/money";

const q = (from: string, to: string, rate: string): Quote => ({
  from,
  to,
  rate,
  source: "fixture",
  asOf: "2026-10-31",
});

describe("parseDecimal / toDecimalString", () => {
  it.each([
    ["12.34", "GBP", 1234],
    ["12.3", "GBP", 1230],
    ["12", "GBP", 1200],
    ["0.01", "USD", 1],
    ["-5.50", "EUR", -550],
    ["1234", "JPY", 1234],
    ["1.234", "KWD", 1234],
  ])("parses %s %s -> %i", (value, currency, minor) => {
    expect(parseDecimal(value, currency)).toEqual({ amountMinor: minor, currency });
  });

  it.each([
    ["12.345", "GBP"],
    ["1.5", "JPY"],
    ["1,00", "GBP"],
    ["1e3", "GBP"],
    ["", "GBP"],
    ["12.34", "XXX"],
  ])("rejects %s %s without rounding", (value, currency) => {
    expect(() => parseDecimal(value, currency)).toThrow(MoneyError);
  });

  it.each([
    [1234, "GBP", "12.34"],
    [5, "GBP", "0.05"],
    [-550, "EUR", "-5.50"],
    [1234, "JPY", "1234"],
    [1234, "KWD", "1.234"],
    [0, "USD", "0.00"],
  ])("formats %i %s -> %s", (minor, currency, out) => {
    expect(toDecimalString(money(minor, currency))).toBe(out);
  });

  it("round-trips any safe amount", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), fc.constantFrom("GBP", "JPY", "KWD"), (minor, cur) => {
        expect(parseDecimal(toDecimalString(money(minor, cur)), cur).amountMinor).toBe(minor);
      }),
    );
  });

  it("rejects non-integer and unsafe minor units", () => {
    expect(() => money(1.5, "GBP")).toThrow(MoneyError);
    expect(() => money(2 ** 53, "GBP")).toThrow(MoneyError);
  });
});

describe("divRound", () => {
  it.each<[bigint, bigint, Rounding, bigint]>([
    [25n, 10n, "HALF_EVEN", 2n],
    [35n, 10n, "HALF_EVEN", 4n],
    [-25n, 10n, "HALF_EVEN", -2n],
    [-35n, 10n, "HALF_EVEN", -4n],
    [26n, 10n, "HALF_EVEN", 3n],
    [25n, 10n, "HALF_UP", 3n],
    [-25n, 10n, "HALF_UP", -3n],
    [24n, 10n, "HALF_UP", 2n],
    [21n, 10n, "CEIL", 3n],
    [-25n, 10n, "CEIL", -2n],
    [29n, 10n, "FLOOR", 2n],
    [-25n, 10n, "FLOOR", -3n],
    [30n, 10n, "CEIL", 3n],
  ])("%i/%i %s = %i", (n, d, mode, out) => {
    expect(divRound(n, d, mode)).toBe(out);
  });

  it("orders FLOOR <= HALF_EVEN <= CEIL and stays within one unit", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        (n, d) => {
          const f = divRound(n, d, "FLOOR");
          const h = divRound(n, d, "HALF_EVEN");
          const c = divRound(n, d, "CEIL");
          expect(f <= h && h <= c).toBe(true);
          expect(c - f <= 1n).toBe(true);
        },
      ),
    );
  });
});

describe("convert", () => {
  const quotes = [q("GBP", "USD", "1.337"), q("JPY", "USD", "0.0067"), q("KWD", "USD", "3.25")];

  it("uses a direct quote exactly", () => {
    expect(convert(money(1_000, "GBP"), "USD", quotes, "HALF_EVEN")).toEqual(money(1_337, "USD"));
  });

  it("uses the inverse of a quote", () => {
    // 12.34 / 1.337 = 9.2296... -> 9.23
    expect(convert(money(1_234, "USD"), "GBP", quotes, "HALF_EVEN")).toEqual(money(923, "GBP"));
  });

  it("handles exponent 0 and 3 currencies", () => {
    expect(convert(money(1_000, "JPY"), "USD", quotes, "HALF_EVEN")).toEqual(money(670, "USD"));
    // 1.234 KWD * 3.25 = 4.0105 USD
    expect(convert(money(1_234, "KWD"), "USD", quotes, "HALF_EVEN")).toEqual(money(401, "USD"));
    expect(convert(money(1_234, "KWD"), "USD", quotes, "CEIL")).toEqual(money(402, "USD"));
  });

  it("returns the same money when currencies match", () => {
    expect(convert(money(5, "GBP"), "GBP", [], "CEIL")).toEqual(money(5, "GBP"));
  });

  it("throws on a missing quote", () => {
    expect(() => convert(money(100, "EUR"), "USD", quotes, "HALF_EVEN")).toThrow(MissingQuoteError);
  });

  it.each(["1e-3", "-1.2", "0", "abc"])("rejects rate %s", (rate) => {
    expect(() => convert(money(100, "GBP"), "USD", [q("GBP", "USD", rate)], "HALF_EVEN")).toThrow(MoneyError);
  });

  it("is monotonic in the amount", () => {
    fc.assert(
      fc.property(fc.nat({ max: 1e10 }), fc.nat({ max: 1e10 }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const cLo = convert(money(lo, "GBP"), "USD", quotes, "HALF_EVEN").amountMinor;
        const cHi = convert(money(hi, "GBP"), "USD", quotes, "HALF_EVEN").amountMinor;
        expect(cLo <= cHi).toBe(true);
      }),
    );
  });
});

describe("bps helpers", () => {
  it("applies basis points with the chosen rounding", () => {
    expect(applyBps(money(4_901, "GBP"), 200, "CEIL")).toEqual(money(99, "GBP")); // 98.02 -> 99
    expect(applyBps(money(4_901, "GBP"), 200, "HALF_EVEN")).toEqual(money(98, "GBP"));
    expect(applyBps(money(10_000, "GBP"), 2_000, "HALF_EVEN")).toEqual(money(2_000, "GBP"));
  });

  it("removes an included VAT rate", () => {
    // 23.80 incl. 19% VAT -> 20.00 net
    expect(removeIncludedBps(money(2_380, "EUR"), 1_900, "HALF_EVEN")).toEqual(money(2_000, "EUR"));
  });

  it("sums only matching currencies", () => {
    expect(sum([money(1, "GBP"), money(2, "GBP")], "GBP")).toEqual(money(3, "GBP"));
    expect(() => sum([money(1, "GBP"), money(2, "USD")], "GBP")).toThrow(MoneyError);
  });
});
