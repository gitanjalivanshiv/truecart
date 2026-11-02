// In-memory fixed-window limits (single Render instance). Protects the free-tier model and Channel3 credits
// from judges' repeated clicks; the recorded fallback covers what is refused.

const windows = new Map<string, { start: number; count: number }>();

export function allow(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { ok: boolean; retryAfterSec: number } {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return { ok: true, retryAfterSec: 0 };
  }
  if (w.count >= limit) return { ok: false, retryAfterSec: Math.ceil((w.start + windowMs - now) / 1000) };
  w.count++;
  return { ok: true, retryAfterSec: 0 };
}

export const LIMITS = {
  agentTurnsPerVisitor: { limit: 12, windowMs: 10 * 60_000 },
  agentTurnsGlobalPerDay: { limit: Number(process.env.AGENT_DAILY_TURNS ?? 300), windowMs: 24 * 60 * 60_000 },
  searchesPerVisitor: { limit: 20, windowMs: 10 * 60_000 },
  walletLinksPerVisitor: { limit: 5, windowMs: 60 * 60_000 },
};
