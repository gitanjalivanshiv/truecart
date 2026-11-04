// Deterministic adapters: ScriptedAdapter (tests) and replay of recorded conversations (demo fallback when
// the live model is rate-limited or out of quota). A recording stores the model's normalized turns only;
// tools still run for real, so prices, policy and payments are always live code paths.

import { readFileSync } from "node:fs";
import { ModelError, type AgentMessage, type ModelAdapter, type ModelRequest, type ModelResponse } from "../types";

type Turn = Extract<AgentMessage, { role: "assistant" }>;

export function scriptedAdapter(
  turns: Turn[] | ((req: ModelRequest, step: number) => Turn),
  name = "scripted",
): ModelAdapter & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    provider: name,
    model: name,
    requests,
    async complete(req) {
      requests.push(structuredClone(req));
      const step = requests.length - 1;
      const turn = typeof turns === "function" ? turns(req, step) : turns[step];
      if (!turn) throw new ModelError("UNAVAILABLE", `${name}: no scripted turn ${step}`);
      return {
        message: { ...turn, providerRaw: undefined },
        usage: { inputTokens: 100, outputTokens: 20 },
        stopReason: turn.toolCalls.length ? "tool_calls" : "end",
      };
    },
  };
}

export interface Recording {
  description: string;
  model: string;
  recordedAt: string;
  turns: Turn[];
}

/** PayPal order/capture ids and tracking numbers from the recording run would be stale on replay. */
export const scrubRunIds = (text: string) =>
  text.replace(/`?\b[0-9A-Z]{17}\b`?/g, "(see PayPal activity)").replace(/`?\bTC\d{10}[A-Z]{2}\b`?/g, "(see Ledger)");

const PROPOSAL_ID = /^prop_[0-9a-f-]{36}$/;

/** The proposal id the live tools returned most recently in this turn (replay substitutes it for the recorded one). */
function latestProposalId(req: ModelRequest): string | null {
  for (const m of [...req.messages].reverse()) {
    if (m.role !== "tool") continue;
    for (const r of m.results) {
      const id = (r.content as { proposal_id?: unknown } | null)?.proposal_id;
      if (r.name === "propose_purchase" && typeof id === "string") return id;
    }
  }
  return null;
}

export function replayAdapter(file: string): ModelAdapter {
  const rec = JSON.parse(readFileSync(file, "utf8")) as Recording;
  const turns = rec.turns.map((t) => ({ ...t, text: scrubRunIds(t.text) }));
  const replay = (req: ModelRequest, step: number): Turn => {
    const turn = turns[step];
    if (!turn) throw new ModelError("UNAVAILABLE", `replay: no recorded turn ${step}`);
    const current = latestProposalId(req);
    return {
      ...turn,
      toolCalls: turn.toolCalls.map((c) => {
        const args = c.args as { proposal_id?: unknown } | null;
        return current && typeof args?.proposal_id === "string" && PROPOSAL_ID.test(args.proposal_id)
          ? { ...c, args: { ...args, proposal_id: current } }
          : c;
      }),
    };
  };
  return { ...scriptedAdapter(replay, "replay"), model: `replay:${rec.model}` };
}

/** Wraps a live adapter and keeps its normalized turns, so a good run can be saved as the demo fallback. */
export function recordingAdapter(inner: ModelAdapter): ModelAdapter & { turns: Turn[] } {
  const turns: Turn[] = [];
  return {
    provider: inner.provider,
    model: inner.model,
    turns,
    async complete(req): Promise<ModelResponse> {
      const res = await inner.complete(req);
      turns.push({ role: "assistant", text: scrubRunIds(res.message.text), toolCalls: res.message.toolCalls });
      return res;
    },
  };
}
