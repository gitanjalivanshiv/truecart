// Plain-English wording for reason codes, statuses and cost lines. One place, so the UI stays consistent.

export const REASON_TEXT: Record<string, string> = {
  WITHIN_LIMITS: "Within your mandate",
  ABOVE_APPROVAL_THRESHOLD: "Above your auto-buy limit",
  LOW_CONFIDENCE_ESTIMATE: "Cost estimate is uncertain",
  EXCEEDS_PER_PURCHASE_CAP: "Over the per-purchase cap",
  EXCEEDS_MONTHLY_CAP: "Over what is left this month",
  QUANTITY_EXCEEDS_LIMIT: "More units than one purchase allows",
  MERCHANT_COUNTRY_NOT_ALLOWED: "Seller country not allowed",
  MERCHANT_COUNTRY_UNKNOWN: "Seller country unknown",
  ORDER_CURRENCY_NOT_ALLOWED: "Currency not allowed",
  MANDATE_PAUSED: "Purchases are paused",
  MANDATE_EXPIRED: "Mandate has expired",
  WALLET_NOT_LINKED: "No PayPal wallet linked",
  UNKNOWN_MERCHANT: "Seller not identified",
  INVALID_AMOUNT: "Invalid amount",
  INVALID_QUANTITY: "Invalid quantity",
  LANDED_CURRENCY_MISMATCH: "Currency mismatch",
  MANDATE_MISMATCH: "Wrong mandate",
  APPROVAL_USED: "Approval already used",
  APPROVAL_EXPIRED: "Approval expired",
  APPROVAL_MISSING: "Needs your approval",
};
export const reason = (code: string) => REASON_TEXT[code] ?? code.toLowerCase().replaceAll("_", " ");

export const LINE_TEXT: Record<string, string> = {
  item: "Item",
  originVatRemoved: "Origin VAT removed",
  shipping: "Shipping",
  importVat: "UK import VAT",
  importDuty: "Customs duty",
  fxConversion: "Currency conversion",
  deliveryPenalty: "Cost of waiting",
};

export type Tone = "go" | "wait" | "stop" | "plain";
export function tone(status: string): Tone {
  if (["AUTO", "CAPTURED", "DONE", "EXECUTED"].includes(status)) return "go";
  if (
    [
      "NEEDS_APPROVAL",
      "AWAITING_APPROVAL",
      "PENDING",
      "SUBMITTED",
      "RESERVED",
      "EXECUTING",
      "UNKNOWN",
      "DRY_RUN",
    ].includes(status)
  )
    return "wait";
  if (["DENIED", "FAILED", "REJECTED"].includes(status)) return "stop";
  return "plain";
}
export const STATUS_TEXT: Record<string, string> = {
  AUTO: "Auto",
  NEEDS_APPROVAL: "Needs approval",
  AWAITING_APPROVAL: "Awaiting you",
  DENIED: "Denied",
  CAPTURED: "Paid",
  FAILED: "Failed",
  REJECTED: "Rejected",
  PENDING: "Pending",
  SUBMITTED: "Submitted",
  DONE: "Done",
  EXECUTING: "Paying",
  DRY_RUN: "Dry run",
  UNKNOWN: "Unconfirmed",
};
