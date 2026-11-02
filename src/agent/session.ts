// Per-conversation state. Offer refs ("o1", "o2"...) are the only way the model can point at an offer;
// they map to records we produced, so the model cannot invent offers, prices or merchants.

import type { Db } from "@/src/db/database";
import type { PayPalGateway } from "@/src/executor/gateway";
import type { Quote } from "@/src/domain/money";
import type { RankedRow } from "@/src/discovery/rank";
import type { Discovery } from "@/src/discovery/discover";

export interface OfferRef {
  ref: string;
  row: RankedRow;
  quotes: Quote[];
  query: string;
}

export interface AgentSession {
  id: string;
  db: Db;
  mandateId: string;
  /** null = dry run: AUTO purchases are reported but never charged. */
  gateway: PayPalGateway | null;
  discoveryMode: "live" | "replay";
  maskBrands: boolean;
  now: () => Date;
  refs: Map<string, OfferRef>;
  nextRef: number;
  /** Called after each search so the UI (Offers page) can show the full ranking. */
  onSearch?: (result: {
    query: string;
    quantity: number;
    rows: RankedRow[];
    quotes: Quote[];
    fxSource: string;
    discovery: Discovery;
  }) => void;
}

export function newSession(
  args: Omit<AgentSession, "refs" | "nextRef" | "onSearch"> & Pick<AgentSession, "onSearch">,
): AgentSession {
  return { ...args, refs: new Map(), nextRef: 1 };
}
