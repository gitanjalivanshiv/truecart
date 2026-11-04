// Does the model's final answer claim that a purchase happened? Used to correct answers when the executor
// did not capture anything in the turn. It looks for statements that something WAS bought, not for the
// words alone: "purchases under £40 are bought immediately" describes a rule, and "no purchase was
// completed" is a denial. A false positive only appends a true note, but it shows as a warning in the
// activity log, so descriptions of the rules must not trip it.

const VERB = "(?:bought|purchased|paid|ordered|placed|completed|captured|processed|confirmed|checked out)";

const CLAIMS: RegExp[] = [
  // "I bought it", "I've purchased o1", "I have just paid", "I successfully placed the order"
  new RegExp(`\\bI(?:'ve|\\s+have)?\\s+(?:just\\s+|now\\s+|already\\s+|successfully\\s+)?${VERB}\\b`, "i"),
  // "has been placed", "have been bought"
  new RegExp(`\\b(?:has|have)\\s+been\\s+(?:successfully\\s+)?${VERB}\\b`, "i"),
  // "the order was placed", "payment went through", "your purchase is complete"
  /\b(?:purchase|order|payment|checkout)\b[^.!?\n]{0,40}?\b(?:is|was|went)\s+(?:now\s+)?(?:complete|completed|confirmed|successful|through|placed|processed|captured|done)\b/i,
  // "Order placed", "Payment successful", "Purchase complete"
  /\b(?:order|purchase|payment|checkout)\s+(?:placed|complete|completed|confirmed|successful|succeeded)\b/i,
  // "successfully bought", "bought successfully"
  new RegExp(`\\bsuccessfully\\s+${VERB}\\b|\\b(?:bought|purchased|paid|ordered)\\s+successfully\\b`, "i"),
  // "Bought o3 for you", "purchased the bottle", "ordered 3 units"
  /\b(?:bought|purchased|ordered|paid for)\s+(?:it|them|this|that|the|your|you|a|an|one|o\d{1,3}|\d+)\b/i,
  // "it's paid", "that's bought"
  /\b(?:it's|it\s+is|it\s+was|that's|that\s+is)\s+(?:now\s+)?(?:paid|bought|purchased|ordered)\b/i,
  // the executor's own status word, as the model tends to quote it: "(CAPTURED)", "status: CAPTURED"
  /\(\s*captured\s*\)|\bstatus\b[^.!?\n]{0,15}\bcaptured\b|\b(?:was|is\s+now|been)\s+captured\b/i,
];

const NEGATION =
  /\b(?:no|not|never|nothing|none|cannot|can't|couldn't|didn't|haven't|hasn't|wasn't|isn't|won't|without)\b/i;

/** True when some sentence asserts that a purchase was made (and is not negated just before the claim). */
export function claimsPurchase(text: string): boolean {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    for (const re of CLAIMS) {
      const m = re.exec(sentence);
      if (!m) continue;
      const before = sentence.slice(Math.max(0, m.index - 30), m.index);
      if (!NEGATION.test(before)) return true;
    }
  }
  return false;
}
