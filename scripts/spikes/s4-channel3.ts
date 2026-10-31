// S4 — Channel3 multi-locale search: shared product ids across GB/US/DE? shipping/delivery/stock fields?
// Docs: channel3.ai/docs (POST https://api.trychannel3.com/v1/search, x-api-key, config.{country,currency,language})
//   npm run spike:channel3 -- [--queries "insulated water bottle 1l|french press"] [--limit 10]
// Every raw response is recorded to fixtures/channel3/ (record/replay seed).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arg, requireEnv, run, save, show } from "./_lib";

const LOCALES = [
  { country: "GB", currency: "GBP", language: "en" },
  { country: "US", currency: "USD", language: "en" },
  { country: "DE", currency: "EUR", language: "de" },
] as const;

const DEFAULT_QUERIES = [
  "insulated stainless steel water bottle 1 litre",
  "glass french press coffee maker",
  "cast iron skillet 26cm",
];

type Offer = Record<string, unknown> & {
  domain?: string;
  price?: { price?: number; currency?: string };
  availability?: string;
};
type Product = Record<string, unknown> & { id: string; title: string; brands?: { name: string }[]; offers?: Offer[] };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function tldCountry(domain = ""): string {
  if (domain.endsWith(".co.uk") || domain.endsWith(".uk")) return "GB";
  if (domain.endsWith(".de")) return "DE";
  if (domain.endsWith(".com")) return "?(.com)";
  return `?(${domain.split(".").pop()})`;
}

async function search(query: string, locale: (typeof LOCALES)[number], limit: number) {
  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": process.env.CHANNEL3_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit, config: locale }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`channel3 ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  return JSON.parse(text) as { products: Product[]; next_page_token?: string | null };
}

run(async () => {
  requireEnv("CHANNEL3_API_KEY");
  const queries = (arg("queries")?.split("|") ?? DEFAULT_QUERIES).map((q) => q.trim()).filter(Boolean);
  const limit = Number(arg("limit", "10"));
  const dir = join(process.cwd(), "fixtures/channel3");
  mkdirSync(dir, { recursive: true });

  const report: Record<string, unknown> = {};
  for (const q of queries) {
    const byLocale: Record<string, Product[]> = {};
    for (const loc of LOCALES) {
      const t0 = Date.now();
      const data = await search(q, loc, limit);
      writeFileSync(
        join(dir, `spike-${slug(q)}-${loc.country}.json`),
        JSON.stringify(
          { request: { query: q, limit, config: loc }, recordedAt: new Date().toISOString(), response: data },
          null,
          2,
        ),
      );
      byLocale[loc.country] = data.products;
      console.log(`${q} [${loc.country}] ${data.products.length} products in ${Date.now() - t0}ms`);
    }

    const ids = Object.fromEntries(Object.entries(byLocale).map(([c, ps]) => [c, new Set(ps.map((p) => p.id))]));
    const titles = Object.fromEntries(
      Object.entries(byLocale).map(([c, ps]) => [c, new Set(ps.map((p) => norm(p.title)))]),
    );
    const inter = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length;
    const offers = Object.values(byLocale)
      .flat()
      .flatMap((p) => p.offers ?? []);
    const offerKeys = [...new Set(offers.flatMap((o) => Object.keys(o)))].sort();
    const productKeys = [
      ...new Set(
        Object.values(byLocale)
          .flat()
          .flatMap((p) => Object.keys(p)),
      ),
    ].sort();

    report[q] = {
      sharedIds: { GB_US: inter(ids.GB, ids.US), GB_DE: inter(ids.GB, ids.DE), US_DE: inter(ids.US, ids.DE) },
      sharedNormalizedTitles: {
        GB_US: inter(titles.GB, titles.US),
        GB_DE: inter(titles.GB, titles.DE),
        US_DE: inter(titles.US, titles.DE),
      },
      offerKeys,
      productKeys,
      hasShippingField: offerKeys.some((k) => /ship|deliver/i.test(k)),
      offerCurrencyMatchesLocale: Object.fromEntries(
        LOCALES.map((l) => {
          const os = (byLocale[l.country] ?? []).flatMap((p) => p.offers ?? []);
          return [l.country, `${os.filter((o) => o.price?.currency === l.currency).length}/${os.length}`];
        }),
      ),
      availability: [...new Set(offers.map((o) => o.availability))],
      offerDomainCountry: Object.fromEntries(
        LOCALES.map((l) => {
          const counts: Record<string, number> = {};
          for (const o of (byLocale[l.country] ?? []).flatMap((p) => p.offers ?? []))
            counts[tldCountry(o.domain)] = (counts[tldCountry(o.domain)] ?? 0) + 1;
          return [l.country, counts];
        }),
      ),
      brandedShare:
        Object.values(byLocale)
          .flat()
          .filter((p) => (p.brands ?? []).length > 0).length +
        "/" +
        Object.values(byLocale).flat().length,
      sampleTitles: Object.fromEntries(
        Object.entries(byLocale).map(([c, ps]) => [c, ps.slice(0, 3).map((p) => p.title)]),
      ),
    };
  }
  save("s4-channel3", report);
  show("S4 report", report);
});
