// FX quotes with a recorded fallback, so ranking still works when the public rate source is down
// (and is deterministic in demo mode). The source and date always travel with the quotes.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { frankfurter } from "./frankfurter";
import type { Quote } from "./types";

const DIR = join(process.cwd(), "fixtures/fx"); // committed snapshot (demo mode)
const LIVE_DIR = join(process.cwd(), "data/fx-cache"); // refreshed by live runs, git-ignored
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

function readFrom(dir: string, base: string): Quote[] | undefined {
  try {
    return z.array(QuoteSchema).parse(JSON.parse(readFileSync(join(dir, `${base}.json`), "utf8")));
  } catch {
    return undefined;
  }
}

/** Replay uses the committed snapshot; the live fallback prefers the latest local live recording. */
const readRecorded = (base: string, preferLive = false) =>
  preferLive ? (readFrom(LIVE_DIR, base) ?? readFrom(DIR, base)) : readFrom(DIR, base);

export async function getQuotes(base: string, targets: string[], opts: { mode: "live" | "replay" }): Promise<QuoteSet> {
  const wanted = targets.filter((t) => t !== base);
  const recorded = readRecorded(base, opts.mode === "live");
  const covers = (qs?: Quote[]) => !!qs && wanted.every((t) => qs.some((q) => q.to === t));
  if (opts.mode === "replay") {
    if (!covers(recorded)) throw new Error(`no recorded FX quotes for ${base} -> ${wanted.join(",")}`);
    return { quotes: recorded!, source: "recorded" };
  }
  try {
    const quotes = await frankfurter.quote(base, wanted);
    try {
      mkdirSync(LIVE_DIR, { recursive: true });
      writeFileSync(join(LIVE_DIR, `${base}.json`), JSON.stringify(quotes, null, 2));
    } catch {
      /* best effort */
    }
    return { quotes, source: "live" };
  } catch (err) {
    if (covers(recorded)) return { quotes: recorded!, source: "recorded" };
    throw err;
  }
}
