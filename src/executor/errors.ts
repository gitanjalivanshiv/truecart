// Classifies PayPal failures. Codes from developer.paypal.com/api/orders/v2/error-messages (checked 2026-11-02).
// TRANSIENT: safe to retry with the SAME PayPal-Request-Id (PayPal returns the original order; spike S1).

import { PayPalApiError, PayPalTimeoutError } from "@/src/integrations/paypal/client";

export type FailureKind = "TRANSIENT" | "DECLINED" | "WALLET" | "MERCHANT" | "CONFIG";

const WALLET = new Set([
  "INVALID_VAULT_ID",
  "MISMATCHED_VAULT_ID_TO_PAYMENT_SOURCE",
  "PAYMENT_SOURCE_CANNOT_BE_USED",
  "PAYER_ACTION_REQUIRED",
  "PAYER_ACCOUNT_RESTRICTED",
  "PAYER_ACCOUNT_LOCKED_OR_CLOSED",
  "AGREEMENT_ALREADY_CANCELLED",
  "TOKEN_ID_NOT_FOUND",
  "TOKEN_EXPIRED",
  "CONSENT_NEEDED",
]);
const MERCHANT = new Set([
  "PAYEE_ACCOUNT_RESTRICTED",
  "PAYEE_ACCOUNT_LOCKED_OR_CLOSED",
  "TRANSACTION_RECEIVING_LIMIT_EXCEEDED",
  "NOT_ENABLED_FOR_PAYMENT_SOURCE",
  "INVALID_CURRENCY_CODE",
  "NOT_ELIGIBLE_FOR_TOKEN_PROCESSING",
]);

export interface ClassifiedFailure {
  kind: FailureKind;
  code: string;
  message: string;
  debugId?: string;
}

export function classifyFailure(err: unknown): ClassifiedFailure {
  if (err instanceof PayPalTimeoutError) return { kind: "TRANSIENT", code: "TIMEOUT", message: err.message };
  if (err instanceof PayPalApiError) {
    const code = err.issue ?? `HTTP_${err.status}`;
    const base = { code, message: err.message, debugId: err.debugId };
    if (err.status === 429 || err.status >= 500) return { kind: "TRANSIENT", ...base };
    if (err.status === 401 || err.status === 403) return { kind: "CONFIG", ...base };
    if (WALLET.has(code)) return { kind: "WALLET", ...base };
    if (MERCHANT.has(code)) return { kind: "MERCHANT", ...base };
    return { kind: "DECLINED", ...base }; // INSTRUMENT_DECLINED, TRANSACTION_REFUSED, PAYMENT_DENIED, ...
  }
  // fetch() network failures surface as TypeError ("fetch failed").
  if (err instanceof TypeError) return { kind: "TRANSIENT", code: "NETWORK", message: err.message };
  return { kind: "CONFIG", code: "UNEXPECTED", message: (err as Error)?.message ?? String(err) };
}
