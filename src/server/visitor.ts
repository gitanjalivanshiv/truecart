// Resolves the visitor's workspace: one mandate per visitor, created on first use from the demo defaults.

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { Db } from "@/src/db/database";
import { getDb } from "@/src/db/instance";
import { getMandate, saveMandate } from "@/src/db/repositories";
import type { Mandate } from "@/src/domain/mandate";
import { demoMandate } from "@/src/discovery/demoMandate";

const VALID = /^[0-9a-f-]{36}$/;

export class NoVisitorError extends Error {
  override name = "NoVisitorError";
}

export async function visitorId(): Promise<string> {
  const fromCookie = (await cookies()).get("tc_vid")?.value;
  if (fromCookie && VALID.test(fromCookie)) return fromCookie;
  const fromProxy = (await headers()).get("x-tc-visitor");
  if (fromProxy && VALID.test(fromProxy)) return fromProxy;
  throw new NoVisitorError("missing visitor id");
}

export const mandateIdFor = (vid: string) => `m_${createHash("sha256").update(vid).digest("hex").slice(0, 20)}`;

/** The shared sandbox buyer wallet (vaulted in spike S1) that new workspaces may use. Never sent to clients. */
export const demoWalletToken = () => process.env.DEMO_WALLET_TOKEN || null;

export function ensureMandate(db: Db, vid: string, now = new Date()): Mandate {
  const id = mandateIdFor(vid);
  const existing = getMandate(db, id);
  if (existing) return existing;
  const m = { ...demoMandate(demoWalletToken(), now), id };
  saveMandate(db, m, now);
  return m;
}

export async function workspace() {
  const vid = await visitorId();
  const db = getDb();
  const mandate = ensureMandate(db, vid);
  return { vid, db, mandate };
}
