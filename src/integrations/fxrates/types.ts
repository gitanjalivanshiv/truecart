// Every cross-currency comparison goes through an explicit Quote (SPEC 5.1); the type lives in the pure domain.
import type { Quote } from "@/src/domain/money";

export type { Quote };

export interface FxRateSource {
  readonly name: "paypal-fxaas" | "frankfurter" | "fixture";
  quote(from: string, to: string[]): Promise<Quote[]>;
}

export class FxUnavailableError extends Error {
  override name = "FxUnavailableError";
}
