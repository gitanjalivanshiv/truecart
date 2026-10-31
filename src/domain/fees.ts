// What the merchant pays PayPal (SPEC F12). Seller-side only: never added to the buyer's landed cost.
// Shown in the "merchant pays" panel and compared against seller_receivable_breakdown in reconciliation.

import { add, applyBps, money, type Money } from "./money";
import type { FeeTable } from "./referenceData";

export interface MerchantFeeEstimate {
  percent: Money;
  international: Money;
  fixed: Money;
  total: Money;
}

export function merchantFee(charged: Money, international: boolean, table: FeeTable["merchant"]): MerchantFeeEstimate {
  const fixedMinor = table.fixedMinor[charged.currency];
  if (fixedMinor === undefined) throw new Error(`no fixed fee configured for ${charged.currency}`);
  const percent = applyBps(charged, table.percentBps, "HALF_UP");
  const intl = international ? applyBps(charged, table.internationalBps, "HALF_UP") : money(0, charged.currency);
  const fixed = money(fixedMinor, charged.currency);
  return { percent, international: intl, fixed, total: add(add(percent, intl), fixed) };
}
