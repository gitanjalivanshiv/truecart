// Every cross-currency comparison goes through an explicit Quote (SPEC 5.1).
// Rates are decimal strings; never parse them into floats for money maths.

export interface Quote {
  from: string; // ISO-4217
  to: string;
  rate: string; // 1 `from` = rate `to`
  source: "paypal-fxaas" | "frankfurter" | "fixture";
  asOf: string; // ISO date/time the rate refers to
}

export interface FxRateSource {
  readonly name: Quote["source"];
  quote(from: string, to: string[]): Promise<Quote[]>;
}

export class FxUnavailableError extends Error {
  override name = "FxUnavailableError";
}
