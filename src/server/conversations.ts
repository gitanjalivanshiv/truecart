// Agent conversations live in memory (single instance), keyed by visitor + conversation id, with a TTL.
// They hold the offer refs the model may use and the trimmed message history.

import { newSession, type AgentSession } from "@/src/agent/session";
import type { AgentMessage } from "@/src/agent/types";
import type { Db } from "@/src/db/database";
import { discoveryMode } from "@/src/discovery/discover";
import { paypalGateway } from "@/src/executor/gateway";
import { lookupOrderViaToolkit } from "@/src/integrations/paypal/toolkit";
import { brandMaskingEnabled } from "@/src/integrations/channel3/mask";

interface Conversation {
  session: AgentSession;
  history: AgentMessage[];
  lastUsed: number;
}

const TTL_MS = 2 * 60 * 60_000;
const store = new Map<string, Conversation>();

export function conversation(db: Db, vid: string, conversationId: string, mandateId: string): Conversation {
  const key = `${vid}:${conversationId}`;
  const now = Date.now();
  for (const [k, c] of store) if (now - c.lastUsed > TTL_MS) store.delete(k);
  let c = store.get(key);
  if (!c) {
    c = {
      session: newSession({
        id: `${vid.slice(0, 8)}:${conversationId}`,
        db,
        mandateId,
        gateway: paypalGateway,
        paypalLookup: (orderId) => lookupOrderViaToolkit(orderId),
        discoveryMode: discoveryMode(),
        maskBrands: brandMaskingEnabled(),
        now: () => new Date(),
      }),
      history: [],
      lastUsed: now,
    };
    store.set(key, c);
  }
  c.lastUsed = now;
  return c;
}
