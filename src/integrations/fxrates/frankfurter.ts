// Public reference rates (no key). Docs: https://frankfurter.dev — v2 blends central-bank sources, daily.
// Used when PayPal's FX quote API is not available to our app (SPEC F3). Labelled "estimate" in the UI.

import { z } from "zod";
import { FxUnavailableError, type FxRateSource, type Quote } from "./types";

const BASE = "https://api.frankfurter.dev/v2";
const Row = z.object({ date: z.string(), base: z.string(), quote: z.string(), rate: z.number() });

export const frankfurter: FxRateSource = {
  name: "frankfurter",
  async quote(from, to) {
    const url = `${BASE}/rates?base=${encodeURIComponent(from)}&quotes=${to.map(encodeURIComponent).join(",")}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    } catch (err) {
      throw new FxUnavailableError(`frankfurter unreachable: ${(err as Error).name}`);
    }
    if (!res.ok) throw new FxUnavailableError(`frankfurter ${res.status}`);
    // The API returns JSON numbers; we keep the exact text of each rate to avoid float drift.
    const text = await res.text();
    const rows = z.array(Row).parse(JSON.parse(text));
    const rawRates = [...text.matchAll(/"quote":"([A-Z]{3})","rate":([0-9.eE+-]+)/g)];
    const exact = new Map(rawRates.map((m) => [m[1], m[2]]));
    return rows.map<Quote>((r) => ({
      from: r.base,
      to: r.quote,
      rate: exact.get(r.quote) ?? String(r.rate),
      source: "frankfurter",
      asOf: r.date,
    }));
  },
};
