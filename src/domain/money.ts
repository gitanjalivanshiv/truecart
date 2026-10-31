// Money: integer minor units + ISO-4217 exponents. No floats anywhere (project rule).
//
// Rounding rules (tested in tests/unit/money.test.ts):
// - Display and landed-cost lines: HALF_EVEN per line; totals are the sum of the rounded lines, so a
//   waterfall always adds up exactly to its total.
// - Policy worst-case amounts: CEIL (round against the buyer's limit, never in its favour).
// - Merchant fee model: HALF_UP (closest to how fees are usually quoted; reconciliation measures the error).
// Rates are decimal strings parsed into exact BigInt rationals; every conversion rounds exactly once.

import { z } from "zod";

export const CURRENCY_EXPONENT = {
  USD: 2,
  GBP: 2,
  EUR: 2,
  CAD: 2,
  AUD: 2,
  CHF: 2,
  SEK: 2,
  PLN: 2,
  CZK: 2,
  RON: 2,
  JPY: 0,
  KWD: 3,
} as const;

export type CurrencyCode = keyof typeof CURRENCY_EXPONENT;
export const CURRENCIES = Object.keys(CURRENCY_EXPONENT) as CurrencyCode[];
export const CurrencyCodeSchema = z.enum(CURRENCIES as [CurrencyCode, ...CurrencyCode[]]);
export const MinorAmountSchema = z.number().int().refine(Number.isSafeInteger, "amount exceeds safe integer range");

export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export type Rounding = "HALF_EVEN" | "HALF_UP" | "CEIL" | "FLOOR";

/** A rate: 1 unit of `from` = `rate` units of `to`. */
export interface Quote {
  from: string;
  to: string;
  rate: string;
  source: string;
  asOf: string;
}

export class MoneyError extends Error {
  override name = "MoneyError";
}

export class MissingQuoteError extends MoneyError {
  override name = "MissingQuoteError";
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`no FX quote for ${from}->${to}`);
  }
}

export function isCurrency(code: string): code is CurrencyCode {
  return Object.hasOwn(CURRENCY_EXPONENT, code);
}

export function exponentOf(currency: CurrencyCode): number {
  return CURRENCY_EXPONENT[currency];
}

export function money(amountMinor: number, currency: string): Money {
  if (!isCurrency(currency)) throw new MoneyError(`unsupported currency ${currency}`);
  if (!Number.isSafeInteger(amountMinor)) throw new MoneyError(`amount must be a safe integer of minor units`);
  return { amountMinor, currency };
}

export const zero = (currency: CurrencyCode): Money => ({ amountMinor: 0, currency });

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new MoneyError(`currency mismatch ${a.currency} vs ${b.currency}`);
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

export function multiply(m: Money, factor: number): Money {
  if (!Number.isSafeInteger(factor)) throw new MoneyError("factor must be an integer");
  return money(toSafe(BigInt(m.amountMinor) * BigInt(factor)), m.currency);
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
}

/** Strict parse of a decimal string ("12.34") into minor units. Never rounds: too many decimals is an error. */
export function parseDecimal(value: string, currency: string): Money {
  if (!isCurrency(currency)) throw new MoneyError(`unsupported currency ${currency}`);
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new MoneyError(`not a decimal amount`);
  const [, sign, whole, frac = ""] = match;
  const exp = exponentOf(currency);
  if (frac.length > exp) throw new MoneyError(`${currency} allows at most ${exp} decimal places`);
  const minor = BigInt(whole + frac.padEnd(exp, "0")) * (sign ? -1n : 1n);
  return money(toSafe(minor), currency);
}

/** Minor units to the decimal string PayPal expects in `amount.value` ("12.34", JPY "1234"). */
export function toDecimalString(m: Money): string {
  const exp = exponentOf(m.currency);
  const abs = Math.abs(m.amountMinor)
    .toString()
    .padStart(exp + 1, "0");
  const sign = m.amountMinor < 0 ? "-" : "";
  return exp === 0 ? `${sign}${abs}` : `${sign}${abs.slice(0, -exp)}.${abs.slice(-exp)}`;
}

interface Rational {
  num: bigint;
  den: bigint;
}

/** Parses a positive decimal rate string exactly. Rejects exponent notation and zero. */
export function parseRate(rate: string): Rational {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!match) throw new MoneyError(`invalid rate`);
  const [, whole, frac = ""] = match;
  const num = BigInt(whole + frac);
  if (num === 0n) throw new MoneyError("rate must be positive");
  return { num, den: 10n ** BigInt(frac.length) };
}

export function divRound(n: bigint, d: bigint, mode: Rounding): bigint {
  if (d <= 0n) throw new MoneyError("divisor must be positive");
  const q = n / d; // truncates toward zero
  const r = n % d;
  if (r === 0n) return q;
  const neg = n < 0n;
  const away = neg ? q - 1n : q + 1n;
  const twice = 2n * (neg ? -r : r);
  switch (mode) {
    case "FLOOR":
      return neg ? q - 1n : q;
    case "CEIL":
      return neg ? q : q + 1n;
    case "HALF_UP":
      return twice >= d ? away : q;
    case "HALF_EVEN":
      if (twice > d) return away;
      if (twice < d) return q;
      return q % 2n === 0n ? q : away;
  }
}

function toSafe(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError("amount exceeds safe integer range");
  }
  return Number(v);
}

/** Converts `m` into `to` using a direct or inverse quote. Same currency is returned unchanged. */
export function convert(m: Money, to: CurrencyCode, quotes: readonly Quote[], rounding: Rounding): Money {
  if (m.currency === to) return m;
  const scaleFrom = 10n ** BigInt(exponentOf(m.currency));
  const scaleTo = 10n ** BigInt(exponentOf(to));
  const amount = BigInt(m.amountMinor);

  const direct = quotes.find((q) => q.from === m.currency && q.to === to);
  if (direct) {
    const r = parseRate(direct.rate);
    return money(toSafe(divRound(amount * r.num * scaleTo, r.den * scaleFrom, rounding)), to);
  }
  const inverse = quotes.find((q) => q.from === to && q.to === m.currency);
  if (inverse) {
    const r = parseRate(inverse.rate);
    return money(toSafe(divRound(amount * r.den * scaleTo, r.num * scaleFrom, rounding)), to);
  }
  throw new MissingQuoteError(m.currency, to);
}

/** m × bps / 10 000 (1 bps = 0.01%). */
export function applyBps(m: Money, bps: number, rounding: Rounding): Money {
  if (!Number.isSafeInteger(bps)) throw new MoneyError("bps must be an integer");
  return money(toSafe(divRound(BigInt(m.amountMinor) * BigInt(bps), 10_000n, rounding)), m.currency);
}

/** Removes an included percentage: gross × 10 000 / (10 000 + bps). Used to strip origin VAT on export. */
export function removeIncludedBps(gross: Money, bps: number, rounding: Rounding): Money {
  if (!Number.isSafeInteger(bps) || bps < 0) throw new MoneyError("bps must be a non-negative integer");
  return money(toSafe(divRound(BigInt(gross.amountMinor) * 10_000n, 10_000n + BigInt(bps), rounding)), gross.currency);
}
