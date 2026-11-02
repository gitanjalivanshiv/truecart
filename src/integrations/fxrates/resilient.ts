// FX quotes with a recorded fallback, so ranking still works when the public rate source is down
// (and is deterministic in demo mode). The source and date always travel with the quotes.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { frankfurter } from "./frankfurter";
import type { Quote } from "./types";

const DIR = join(process.cwd(), "fixtures/fx");
const QuoteSchema = z.object({
  from: z.string(),
  to: z.string(),
  rate: z.string(),
  source: z.string(),
  asOf: z.string(),
});

export interface QuoteSet {
  quotes: Quote[];
  source: "live" | "recorded";
}

function readRecorded(base: string): Quote[] | undefined {
  try {
    return z.array(QuoteSchema).parse(JSON.parse(readFileSync(join(DIR, `${base}.json`), "utf8")));
  } catch {
    return undefined;
  }
}

export async function getQuotes(base: string, targets: string[], opts: { mode: "live" | "replay" }): Promise<QuoteSet> {
  const wanted = targets.filter((t) => t !== base);
  const recorded = readRecorded(base);
  const covers = (qs?: Quote[]) => !!qs && wanted.every((t) => qs.some((q) => q.to === t));
  if (opts.mode === "replay") {
    if (!covers(recorded)) throw new Error(`no recorded FX quotes for ${base} -> ${wanted.join(",")}`);
    return { quotes: recorded!, source: "recorded" };
  }
  try {
    const quotes = await frankfurter.quote(base, wanted);
    try {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(join(DIR, `${base}.json`), JSON.stringify(quotes, null, 2));
    } catch {
      /* best effort */
    }
    return { quotes, source: "live" };
  } catch (err) {
    if (covers(recorded)) return { quotes: recorded!, source: "recorded" };
    throw err;
  }
}
