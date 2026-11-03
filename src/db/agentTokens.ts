// Mandate tokens for outside agents (TrueCart's MCP server). A token lets an agent shop inside ONE mandate:
// the same policy, approvals and executor apply. It cannot change limits. Stored as a sha256 hash only.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "./database";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const TOKEN = /^tc_mcp_[A-Za-z0-9_-]{43}$/;

export interface AgentTokenView {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  hint: string; // last 4 chars, to tell tokens apart
}

/** Returns the plaintext token exactly once. */
export function createAgentToken(
  db: Db,
  mandateId: string,
  label: string,
  now = new Date(),
): { id: string; token: string } {
  const token = `tc_mcp_${randomBytes(32).toString("base64url")}`;
  const id = `tok_${randomUUID()}`;
  db.prepare("INSERT INTO agent_tokens (id, mandate_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    mandateId,
    `${hash(token)}:${token.slice(-4)}`,
    label.slice(0, 60),
    now.toISOString(),
  );
  return { id, token };
}

export function resolveAgentToken(
  db: Db,
  token: string | null | undefined,
  now = new Date(),
): { tokenId: string; mandateId: string } | null {
  if (!token || !TOKEN.test(token)) return null;
  const row = db
    .prepare("SELECT id, mandate_id FROM agent_tokens WHERE token_hash = ? AND revoked_at IS NULL")
    .get(`${hash(token)}:${token.slice(-4)}`) as { id: string; mandate_id: string } | undefined;
  if (!row) return null;
  db.prepare("UPDATE agent_tokens SET last_used_at = ? WHERE id = ?").run(now.toISOString(), row.id);
  return { tokenId: row.id, mandateId: row.mandate_id };
}

export function listAgentTokens(db: Db, mandateId: string): AgentTokenView[] {
  const rows = db
    .prepare(
      "SELECT id, label, token_hash, created_at, last_used_at, revoked_at FROM agent_tokens WHERE mandate_id = ? ORDER BY created_at DESC",
    )
    .all(mandateId) as {
    id: string;
    label: string;
    token_hash: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
    hint: r.token_hash.split(":")[1] ?? "",
  }));
}

export function revokeAgentToken(db: Db, id: string, mandateId: string, now = new Date()): boolean {
  return (
    db
      .prepare("UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND mandate_id = ? AND revoked_at IS NULL")
      .run(now.toISOString(), id, mandateId).changes === 1
  );
}
