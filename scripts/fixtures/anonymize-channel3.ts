// Turns raw Channel3 recordings into the anonymized fixtures committed to the public repo.
// Channel3's guidance allows light caching for your own UI; long-term storage needs their agreement, so
// the repo only carries derived data: product ids (stable per Channel3), prices, currencies, availability,
// generic titles, pseudonymous brands and stores. No descriptions, images, buy links or retailer names.
//   npx tsx scripts/fixtures/anonymize-channel3.ts <raw-dir> <out-dir>

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { genericTitle } from "@/src/integrations/channel3/mask";

const h = (s: string) => createHash("sha256").update(s.toLowerCase()).digest("hex").slice(0, 6);

/** Keeps what the country inference needs (country-code TLD, uk./us./de. subdomain), replaces the rest. */
export function pseudonymousDomain(domain: string): string {
  const host = domain.toLowerCase().replace(/^www\./, "");
  const labels = host.split(".");
  const sub = ["uk", "us", "de", "gb"].includes(labels[0]) && labels.length > 2 ? `${labels[0]}.` : "";
  const suffix = host.endsWith(".co.uk") ? "co.uk" : host.endsWith(".com.au") ? "com.au" : labels[labels.length - 1];
  return `${sub}store-${h(host.replace(/^(uk|us|de|gb)\./, ""))}.${suffix}`;
}

type Raw = { request: unknown; recordedAt: string; response: { products: Record<string, unknown>[]; next_page_token?: unknown } };

function anonymize(env: Raw) {
  return {
    request: env.request,
    recordedAt: env.recordedAt,
    note: "Anonymized from a Channel3 search recorded at recordedAt: generic titles, pseudonymous brands and stores; no descriptions, images or links.",
    response: {
      products: env.response.products.map((p) => {
        const brands = (p.brands as { name: string }[] | null | undefined) ?? [];
        return {
          id: p.id,
          title: genericTitle(String(p.title ?? "")),
          description: "",
          brands: brands.slice(0, 1).map((b) => ({ name: `Brand ${h(b.name)}` })),
          offers: ((p.offers as Record<string, unknown>[] | null | undefined) ?? []).map((o) => {
            const domain = pseudonymousDomain(String(o.domain ?? ""));
            const price = o.price as { price: number; compare_at_price?: number | null; currency: string };
            return {
              url: `https://${domain}/`,
              domain,
              price: { price: price.price, compare_at_price: price.compare_at_price ?? null, currency: price.currency },
              availability: o.availability,
              condition: o.condition ?? null,
            };
          }),
        };
      }),
      next_page_token: null,
    },
  };
}

const [rawDir, outDir] = process.argv.slice(2);
if (!rawDir || !outDir) throw new Error("usage: anonymize-channel3.ts <raw-dir> <out-dir>");
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(rawDir).filter((x) => x.endsWith(".json"))) {
  const env = JSON.parse(readFileSync(join(rawDir, f), "utf8")) as Raw;
  writeFileSync(join(outDir, f), JSON.stringify(anonymize(env), null, 2) + "\n");
  console.log(`anonymized ${f}`);
}
