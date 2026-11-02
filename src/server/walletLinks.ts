// Pending Vault setup tokens per visitor (in memory; a link must finish within 30 minutes).
const pending = new Map<string, { setupTokenId: string; at: number }>();
const TTL_MS = 30 * 60_000;

export function rememberSetup(vid: string, setupTokenId: string) {
  pending.set(vid, { setupTokenId, at: Date.now() });
}

export function takeSetup(vid: string): string | null {
  const p = pending.get(vid);
  pending.delete(vid);
  return p && Date.now() - p.at < TTL_MS ? p.setupTokenId : null;
}
