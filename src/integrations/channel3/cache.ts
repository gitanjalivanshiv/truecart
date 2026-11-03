// Record/replay for Channel3 (SPEC 5.5). The demo must survive quota exhaustion and judges' repeated runs.
//   replay mode (DEMO_MODE=true): recorded responses only; never spends credits.
//   live mode: call Channel3, record the response; on 402/429/timeout/5xx fall back to the recording.
// Recordings are JSON envelopes { request, recordedAt, response }. The repo carries anonymized ones under
// fixtures/channel3/ (scripts/fixtures/anonymize-channel3.ts); raw live recordings stay in data/ (git-ignored).

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Channel3Error,
  searchProducts,
  SearchResponseSchema,
  type FetchFn,
  type SearchRequest,
  type SearchResponse,
} from "./client";

/** Committed, anonymized recordings (public repo). */
export const FIXTURE_ROOT = join(process.cwd(), "fixtures/channel3");
/** Live recordings (raw Channel3 data): local only, git-ignored. */
export const LIVE_RECORD_DIR = join(process.cwd(), "data/channel3-cache");

export type DiscoverySource = "live" | "recorded";

export interface CachedSearch {
  response: SearchResponse;
  source: DiscoverySource;
  recordedAt: string | null;
  /** Why a recording was used instead of a live call (live mode only). */
  fallbackReason?: string;
  /** Replay mode only: the recorded query used when there was no exact recording. */
  closestRecordedQuery?: string;
}

export const normalizeQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

export function cacheKey(req: SearchRequest): string {
  const canonical = JSON.stringify({
    q: normalizeQuery(req.query),
    limit: req.limit,
    c: req.config.country,
    cur: req.config.currency,
    l: req.config.language,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

type Envelope = { request: SearchRequest; recordedAt: string; response: unknown };

type IndexEntry = { file: string; mtime: number; request: SearchRequest };
const indexes = new Map<string, Map<string, IndexEntry>>(); // per fixture root

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

/** Indexes every recording by request key; the newest recording wins. */
function buildIndex(root: string) {
  const map = new Map<string, IndexEntry>();
  for (const file of walk(root)) {
    try {
      const env = JSON.parse(readFileSync(file, "utf8")) as Envelope;
      if (!env?.request?.query || !env.request.config) continue;
      const key = cacheKey(env.request);
      const mtime = Date.parse(env.recordedAt) || 0;
      if (!map.has(key) || map.get(key)!.mtime < mtime) map.set(key, { file, mtime, request: env.request });
    } catch {
      /* not a recording */
    }
  }
  return map;
}

const words = (q: string) =>
  new Set(
    normalizeQuery(q)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1),
  );

function indexFor(root: string): Map<string, IndexEntry> {
  if (!indexes.has(root)) indexes.set(root, buildIndex(root));
  return indexes.get(root)!;
}

/** Exact recording, or (when `closest`) the most similar recorded query for the same market (word overlap >= 0.5). */
export function readRecording(
  req: SearchRequest,
  opts: { closest?: boolean; root?: string } = {},
): CachedSearch | undefined {
  const roots = opts.root ? [opts.root] : [FIXTURE_ROOT, LIVE_RECORD_DIR];
  const index = new Map<string, IndexEntry>();
  for (const r of roots) {
    for (const [k, e] of indexFor(r)) if (!index.has(k) || index.get(k)!.mtime < e.mtime) index.set(k, e);
  }
  let hit = index.get(cacheKey(req));
  let closestRecordedQuery: string | undefined;
  if (!hit && opts.closest) {
    const want = words(req.query);
    let best = 0;
    for (const entry of index.values()) {
      if (entry.request.config.country !== req.config.country || entry.request.config.currency !== req.config.currency)
        continue;
      const have = words(entry.request.query);
      const inter = [...want].filter((w) => have.has(w)).length;
      const score = inter / (want.size + have.size - inter || 1);
      if (score > best || (score === best && hit && entry.mtime > hit.mtime)) {
        best = score;
        hit = entry;
      }
    }
    if (best < 0.5) hit = undefined;
    else closestRecordedQuery = hit?.request.query;
  }
  if (!hit) return undefined;
  const env = JSON.parse(readFileSync(hit.file, "utf8")) as Envelope;
  return {
    response: SearchResponseSchema.parse(env.response),
    source: "recorded",
    recordedAt: env.recordedAt,
    ...(closestRecordedQuery &&
      normalizeQuery(closestRecordedQuery) !== normalizeQuery(req.query) && { closestRecordedQuery }),
  };
}

function record(req: SearchRequest, response: SearchResponse, now: Date, dir: string): void {
  const slug = normalizeQuery(req.query)
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const file = join(dir, `${slug}-${req.config.country}-${cacheKey(req)}.json`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ request: req, recordedAt: now.toISOString(), response }, null, 2));
    indexFor(dir).set(cacheKey(req), { file, mtime: now.getTime(), request: req });
  } catch {
    /* read-only filesystem (e.g. some hosts): recording is best effort */
  }
}

export class RecordingMissingError extends Error {
  override name = "RecordingMissingError";
}

export async function cachedSearch(
  req: SearchRequest,
  opts: { mode: "live" | "replay"; fetchFn?: FetchFn; now?: Date; apiKey?: string; root?: string },
): Promise<CachedSearch> {
  if (opts.mode === "replay") {
    const rec = readRecording(req, { closest: true, root: opts.root });
    if (!rec) throw new RecordingMissingError(`no recording for "${req.query}" in ${req.config.country} (demo mode)`);
    return rec;
  }
  try {
    const response = await searchProducts(req, { fetchFn: opts.fetchFn, apiKey: opts.apiKey });
    record(req, response, opts.now ?? new Date(), opts.root ?? LIVE_RECORD_DIR);
    return { response, source: "live", recordedAt: null };
  } catch (err) {
    if (err instanceof Channel3Error && err.fallbackable) {
      const rec = readRecording(req, { root: opts.root });
      if (rec) return { ...rec, fallbackReason: `live search unavailable (${err.status})` };
    }
    throw err;
  }
}

/** Test hook: forget the in-memory index. */
export function resetRecordingIndex(): void {
  indexes.clear();
}
