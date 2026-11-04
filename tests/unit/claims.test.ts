import { describe, expect, it } from "vitest";
import { claimsPurchase } from "@/src/agent/claims";

// The answer that produced a false "corrected a claim" warning on 2026-11-04 (live Gemini, no purchase).
const LIMITS_ANSWER = `Here are your current spending limits:

- **Auto-buy limit:** Up to 40.00 GBP (purchases at or below this are bought immediately).
- **Per-purchase cap:** 150.00 GBP.
- **Monthly cap:** 400.00 GBP.
- **Remaining budget this month:** 375.14 GBP (24.86 GBP spent or reserved).
- **Max units per purchase:** 3.`;

describe("claimsPurchase", () => {
  it.each([
    "The purchase has been completed successfully (CAPTURED).",
    "I bought it for you.",
    "Your order was placed.",
    "Payment went through.",
    "Done, it's paid.",
    "I've purchased o1 for £18.99.",
    "I have just placed the order.",
    "Done! Bought o3 at 18.99 GBP.",
    "Your order has been placed.",
    "Payment successful!",
    "Purchase complete.",
    "**Purchase Status:** Bought successfully (**CAPTURED**).",
    "Status: CAPTURED",
    "Order placed for o2.",
    "I successfully ordered 3 units.",
    "I couldn't find a cheaper one, so I bought the UK bottle.",
  ])("flags a claim: %j", (text) => {
    expect(claimsPurchase(text)).toBe(true);
  });

  it.each([
    LIMITS_ANSWER,
    "Purchases at or below £40 are bought immediately; above that they wait for you.",
    "Nothing was bought.",
    "No purchase was completed.",
    "I have not bought anything yet.",
    "The order has not been placed: it is over your per-purchase cap.",
    "Payments are captured only after your approval.",
    "The order will be placed once you approve it in Approvals.",
    "Would you like me to go ahead with o1?",
    "It went to your approval inbox; nothing has been charged.",
    "Your mandate refused this purchase, so no payment was made.",
    "o1 is the cheapest to buy once shipping and VAT are added.",
  ])("does not flag: %j", (text) => {
    expect(claimsPurchase(text)).toBe(false);
  });
});
