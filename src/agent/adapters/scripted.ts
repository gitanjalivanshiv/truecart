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

export function replayAdapter(file: string): ModelAdapter {
  const rec = JSON.parse(readFileSync(file, "utf8")) as Recording;
  return { ...scriptedAdapter(rec.turns, "replay"), model: `replay:${rec.model}` };
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
      turns.push({ role: "assistant", text: res.message.text, toolCalls: res.message.toolCalls });
      return res;
    },
  };
}
