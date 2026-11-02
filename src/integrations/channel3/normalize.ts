// Channel3 product -> NormalizedOffer. This is the trust boundary for merchant data:
// - prices become integer minor units via the strict decimal parser (no float maths);
// - titles/descriptions/brands are UNTRUSTED text: control and invisible characters are stripped and
//   lengths capped here; the agent layer additionally wraps them as data (never instructions);
// - merchant country comes from the store domain when it says so, else the search market (flagged).

import { createHash } from "node:crypto";
import { isCurrency, parseDecimal, type Money } from "@/src/domain/money";
import type { Channel3Product, Locale } from "./client";

export interface NormalizedOffer {
  offerId: string; // stable: product + domain + market
  productId: string;
  market: string; // search country
  title: string; // untrusted, sanitized
  description: string; // untrusted, sanitized, truncated
  brand: string | null; // untrusted, sanitized
  merchantDomain: string;
  merchantId: string;
  merchantCountry: string | null;
  countrySource: "domain" | "locale" | "unknown";
  unitPrice: Money;
  compareAtPrice: Money | null;
  availability: string;
  condition: string | null;
  url: string;
  imageUrl: string | null;
}

export interface DroppedOffer {
  productId: string;
  reason: "PRICE_UNPARSEABLE" | "CURRENCY_MISMATCH" | "UNSUPPORTED_CURRENCY" | "OUT_OF_STOCK" | "NO_OFFERS";
}

// C0/C1 controls, zero-width and bidi-control characters: used to hide instructions in product text.
const INVISIBLE = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]",
  "g",
);

export function sanitizeText(input: string | null | undefined, max: number): string {
  if (!input) return "";
  // Line/paragraph separators become spaces (deleting them would merge words); the rest are removed.
  const clean = input
    .normalize("NFKC")
    .replace(new RegExp("[\\u2028\\u2029]", "g"), " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// Country-code TLDs we can trust as a merchant-country signal. Generic TLDs fall back to the market.
const CC_TLD: Record<string, string> = {
  uk: "GB",
  de: "DE",
  fr: "FR",
  nl: "NL",
  be: "BE",
  se: "SE",
  no: "NO",
  dk: "DK",
  fi: "FI",
  it: "IT",
  es: "ES",
  pt: "PT",
  ie: "IE",
  at: "AT",
  ch: "CH",
  pl: "PL",
  cz: "CZ",
  ro: "RO",
  gr: "GR",
  au: "AU",
  ca: "CA",
  nz: "NZ",
  jp: "JP",
  us: "US",
};
const SUBDOMAIN_COUNTRY: Record<string, string> = { uk: "GB", gb: "GB", us: "US", de: "DE" };

export function inferMerchantCountry(
  domain: string,
  market: string,
): { country: string | null; source: NormalizedOffer["countrySource"] } {
  const host = domain.toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) return { country: null, source: "unknown" };
  const labels = host.split(".");
  const tld = labels[labels.length - 1];
  if (CC_TLD[tld]) return { country: CC_TLD[tld], source: "domain" };
  const sub = labels.length > 2 ? SUBDOMAIN_COUNTRY[labels[0]] : undefined;
  if (sub) return { country: sub, source: "domain" };
  return { country: market, source: "locale" };
}

/** Channel3 sends prices as JSON numbers; String(n) gives the shortest exact decimal, which we parse strictly. */
export function priceToMoney(value: number, currency: string): Money | null {
  if (!Number.isFinite(value) || value < 0 || !isCurrency(currency)) return null;
  try {
    return parseDecimal(String(value), currency);
  } catch {
    return null;
  }
}

const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

export function normalizeProducts(
  products: Channel3Product[],
  locale: Locale,
): { offers: NormalizedOffer[]; dropped: DroppedOffer[] } {
  const offers: NormalizedOffer[] = [];
  const dropped: DroppedOffer[] = [];
  for (const p of products) {
    if (!p.offers?.length) {
      dropped.push({ productId: p.id, reason: "NO_OFFERS" });
      continue;
    }
    for (const o of p.offers) {
      if (o.availability !== "InStock") {
        dropped.push({ productId: p.id, reason: "OUT_OF_STOCK" });
        continue;
      }
      if (!isCurrency(o.price.currency)) {
        dropped.push({ productId: p.id, reason: "UNSUPPORTED_CURRENCY" });
        continue;
      }
      if (o.price.currency !== locale.currency) {
        dropped.push({ productId: p.id, reason: "CURRENCY_MISMATCH" });
        continue;
      }
      const unitPrice = priceToMoney(o.price.price, o.price.currency);
      if (!unitPrice || unitPrice.amountMinor === 0) {
        dropped.push({ productId: p.id, reason: "PRICE_UNPARSEABLE" });
        continue;
      }
      const compare =
        o.price.compare_at_price != null ? priceToMoney(o.price.compare_at_price, o.price.currency) : null;
      const domain = sanitizeText(o.domain, 100).toLowerCase();
      const { country, source } = inferMerchantCountry(domain, locale.country);
      const image = p.images?.find((i) => i.is_main_image)?.url ?? p.images?.[0]?.url ?? null;
      offers.push({
        offerId: `off_${shortHash(`${p.id}|${domain}|${locale.country}`)}`,
        productId: p.id,
        market: locale.country,
        title: sanitizeText(p.title, 200),
        description: sanitizeText(p.description, 1000),
        brand: sanitizeText(p.brands?.[0]?.name, 80) || null,
        merchantDomain: domain,
        merchantId: domain,
        merchantCountry: country,
        countrySource: source,
        unitPrice,
        compareAtPrice: compare && compare.amountMinor > unitPrice.amountMinor ? compare : null,
        availability: o.availability,
        condition: o.condition ?? null,
        url: o.url,
        imageUrl: image,
      });
    }
  }
  return { offers, dropped };
}
