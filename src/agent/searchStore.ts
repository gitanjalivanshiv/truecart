// The latest searches per visitor (in memory), shared by the chat and the Offers page.
// Rows and quotes are server-side records; the browser only ever sends back an offer id.

import { randomUUID } from "node:crypto";
import type { Quote } from "@/src/domain/money";
import type { Discovery } from "@/src/discovery/discover";
import type { RankedRow } from "@/src/discovery/rank";

export interface StoredSearch {
  id: string;
  owner: string; // visitor id
  query: string;
  quantity: number;
  rows: RankedRow[];
  quotes: Quote[];
  fxSource: string;
  markets: Discovery["markets"];
  groups: Discovery["groups"];
  createdAt: string;
  via: "agent" | "search";
}

const MAX_PER_OWNER = 5;
const store = new Map<string, StoredSearch[]>();

export function saveSearch(s: Omit<StoredSearch, "id" | "createdAt">): StoredSearch {
  const full = { ...s, id: `srch_${randomUUID()}`, createdAt: new Date().toISOString() };
  store.set(s.owner, [full, ...(store.get(s.owner) ?? [])].slice(0, MAX_PER_OWNER));
  return full;
}

export function latestSearch(owner: string): StoredSearch | undefined {
  return store.get(owner)?.[0];
}

export function findSearch(owner: string, id: string): StoredSearch | undefined {
  return store.get(owner)?.find((s) => s.id === id);
}
