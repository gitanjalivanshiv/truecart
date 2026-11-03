// Demo-mode trademark hygiene (SPEC 5.5, MASK_BRANDS): brands and retailers get neutral labels, titles keep
// only generic words, and images are hidden. Labels are deterministic for a given offer set, so the UI and video stay stable.
// Display only: real values stay in the data for ranking, matching and payment.

import type { NormalizedOffer } from "./normalize";

export interface DisplayOffer {
  title: string;
  brand: string | null;
  merchant: string;
  imageUrl: string | null;
}

// Masked titles keep only generic, descriptive words. An allowlist (not a brand blocklist) is the only way
// to be sure product-line trademarks never reach the screen.
const GENERIC_WORDS = new Set(
  (
    "insulated water bottle bottles flask thermos thermo vacuum stainless steel steels metal glass plastic bpa free " +
    "leakproof leak proof sport sports straw lid lids narrow wide mouth handle carry loop double wall walled " +
    "large small mini kids travel outdoor hiking gym cold hot drinks drink reusable personalised personalized " +
    "1l 1 litre liter liters litres l ml oz 500ml 750ml 1000ml 1200ml 32oz 24oz 20oz 17oz 18oz 40oz black white " +
    "blue green pink grey gray red silver navy matte coffee press french maker cafetiere cast iron skillet pan " +
    "frying round deep square cup cups set pack of with and for in"
  ).split(" "),
);

export function genericTitle(title: string): string {
  const kept = title
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => GENERIC_WORDS.has(w.toLowerCase()));
  while (kept.length && ["with", "and", "for", "in", "of"].includes(kept[kept.length - 1].toLowerCase())) kept.pop();
  const descriptive = kept.filter((w) => !/^(\d+(l|ml|oz)?|l|ml|oz|litre|liter|litres|liters)$/i.test(w));
  if (descriptive.length < 1 || kept.length < 2) return "Product listing";
  const text = kept.join(" ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function brandMaskingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MASK_BRANDS !== "false";
}

/**
 * `rankOrder` (offer ids, best first) numbers stores within each country by their best-ranked offer, so
 * "Store GB-1" is the cheapest landed UK store in that search. Without it, stores are numbered by name.
 */
export function displayLabels(
  offers: readonly NormalizedOffer[],
  mask: boolean,
  rankOrder?: readonly string[],
): Map<string, DisplayOffer> {
  const out = new Map<string, DisplayOffer>();
  if (!mask) {
    for (const o of offers)
      out.set(o.offerId, { title: o.title, brand: o.brand, merchant: o.merchantDomain, imageUrl: o.imageUrl });
    return out;
  }
  const brands = [...new Set(offers.map((o) => o.brand).filter((b): b is string => !!b))].sort();
  const brandLabel = new Map(
    brands.map((b, i) => [b, `Brand ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}`]),
  );
  const rank = new Map((rankOrder ?? []).map((id, i) => [id, i]));
  const bestRank = new Map<string, number>();
  for (const o of offers) {
    const key = `${o.merchantCountry ?? o.market}|${o.merchantDomain}`;
    bestRank.set(key, Math.min(bestRank.get(key) ?? Infinity, rank.get(o.offerId) ?? Infinity));
  }
  const merchants = [...bestRank.keys()].sort((a, b) => bestRank.get(a)! - bestRank.get(b)! || a.localeCompare(b));
  const counters = new Map<string, number>();
  const merchantLabel = new Map<string, string>();
  for (const m of merchants) {
    const country = m.split("|")[0];
    const n = (counters.get(country) ?? 0) + 1;
    counters.set(country, n);
    merchantLabel.set(m, `Store ${country}-${n}`); // keyed by country + domain: a .com store can appear in several markets
  }
  for (const o of offers) {
    out.set(o.offerId, {
      title: genericTitle(o.title),
      brand: o.brand ? brandLabel.get(o.brand)! : null,
      merchant: merchantLabel.get(`${o.merchantCountry ?? o.market}|${o.merchantDomain}`)!,
      imageUrl: null,
    });
  }
  return out;
}
