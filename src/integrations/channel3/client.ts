// Channel3 product search over REST (docs: channel3.ai/docs, api-reference/v1/search). Verified live in spike S4.
// Every response is zod-checked at the boundary. Prices arrive as JSON numbers; normalize.ts turns them into
// integer minor units without float maths.

import { z } from "zod";

const BASE_URL = "https://api.trychannel3.com";
const TIMEOUT_MS = 30_000; // S4: locale searches took up to several seconds

export const LocaleSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  language: z.string().regex(/^[a-z]{2}$/),
});
export type Locale = z.infer<typeof LocaleSchema>;

export const DEFAULT_LOCALES: Locale[] = [
  { country: "GB", currency: "GBP", language: "en" },
  { country: "US", currency: "USD", language: "en" },
  { country: "DE", currency: "EUR", language: "de" },
];

const Price = z.looseObject({ price: z.number(), compare_at_price: z.number().nullish(), currency: z.string() });
export const OfferSchema = z.looseObject({
  url: z.string(),
  domain: z.string(),
  price: Price,
  availability: z.string(),
  condition: z.string().nullish(),
});
export const ProductSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  brands: z.array(z.looseObject({ id: z.string().optional(), name: z.string() })).nullish(),
  images: z.array(z.looseObject({ url: z.string().optional(), is_main_image: z.boolean().nullish() })).nullish(),
  offers: z.array(OfferSchema).nullish(),
});
export const SearchResponseSchema = z.looseObject({
  products: z.array(ProductSchema),
  next_page_token: z.string().nullish(),
});
export type Channel3Product = z.infer<typeof ProductSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export interface SearchRequest {
  query: string;
  limit: number;
  config: Locale;
}

export class Channel3Error extends Error {
  override name = "Channel3Error";
  constructor(
    readonly status: number | "TIMEOUT" | "NETWORK" | "SCHEMA",
    message: string,
  ) {
    super(message);
  }
  /** Worth serving a recorded response instead. */
  get fallbackable(): boolean {
    return (
      this.status === 402 ||
      this.status === 429 ||
      this.status === "TIMEOUT" ||
      this.status === "NETWORK" ||
      (typeof this.status === "number" && this.status >= 500)
    );
  }
}

export type FetchFn = typeof fetch;

export async function searchProducts(
  req: SearchRequest,
  opts: { apiKey?: string; fetchFn?: FetchFn } = {},
): Promise<SearchResponse> {
  const apiKey = opts.apiKey ?? process.env.CHANNEL3_API_KEY;
  if (!apiKey) throw new Channel3Error(401, "CHANNEL3_API_KEY is not set");
  let res: Response;
  try {
    res = await (opts.fetchFn ?? fetch)(`${BASE_URL}/v1/search`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query: req.query, limit: req.limit, config: req.config }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const name = (err as Error).name;
    throw new Channel3Error(name === "TimeoutError" ? "TIMEOUT" : "NETWORK", `Channel3 request failed: ${name}`);
  }
  if (!res.ok) {
    // 402 = free credits used up (docs). Never echo the body: it could contain request details.
    throw new Channel3Error(res.status, `Channel3 search returned ${res.status}`);
  }
  const parsed = SearchResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Channel3Error("SCHEMA", "Channel3 response did not match the expected schema");
  return parsed.data;
}
