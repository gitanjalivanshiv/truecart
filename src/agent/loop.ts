// One user turn of the agent: model <-> tools until the model answers, capped by steps and tokens.
// Provider-neutral. Safety does not rely on the model: tools re-validate everything and money only moves
// through the executor. The loop adds two guards: strict tool-argument validation and a check that the
// final answer never claims a purchase the executor did not confirm.

import { z } from "zod";
import { claimsPurchase } from "./claims";
import { SYSTEM_PROMPT } from "./prompt";
import type { AgentSession } from "./session";
import { TOOL_SPECS, TOOLS, ToolInputError } from "./tools";
import { ModelError, type AgentMessage, type ModelAdapter } from "./types";

export interface TurnLimits {
  maxSteps: number; // model calls per turn
  maxOutputTokens: number; // per model call
  maxTurnTokens: number; // input + output across the turn
}

export const DEFAULT_LIMITS: TurnLimits = { maxSteps: 8, maxOutputTokens: 1_024, maxTurnTokens: 60_000 };

export type AgentEvent =
  | { type: "model"; step: number; provider: string; model: string; inputTokens: number; outputTokens: number }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; ok: boolean; status?: string }
  | { type: "assistant"; text: string }
  | { type: "guard"; rule: string; detail: string }
  | { type: "error"; kind: string; message: string };

export interface TurnResult {
  text: string;
  history: AgentMessage[];
  events: AgentEvent[];
  usage: { inputTokens: number; outputTokens: number };
  stoppedBy: "answer" | "steps" | "tokens" | "model_error";
}

const PAID_NOTE = " Your purchase in this request went through: see the Ledger for the PayPal order.";

/** Keeps the last `keepUserTurns` user turns (never splits a tool call from its result). */
export function trimHistory(history: AgentMessage[], keepUserTurns = 6): AgentMessage[] {
  const userIdx = history.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  if (userIdx.length <= keepUserTurns) return history;
  return history.slice(userIdx[userIdx.length - keepUserTurns]);
}

export async function runTurn(args: {
  adapter: ModelAdapter;
  session: AgentSession;
  history: AgentMessage[];
  userText: string;
  limits?: TurnLimits;
  onEvent?: (e: AgentEvent) => void;
}): Promise<TurnResult> {
  const limits = args.limits ?? DEFAULT_LIMITS;
  const events: AgentEvent[] = [];
  const emit = (e: AgentEvent) => {
    events.push(e);
    args.onEvent?.(e);
  };
  const messages: AgentMessage[] = [
    ...trimHistory(args.history),
    { role: "user", text: args.userText.slice(0, 2_000) },
  ];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let captured = false;

  for (let step = 1; step <= limits.maxSteps; step++) {
    let res;
    try {
      res = await args.adapter.complete({
        system: SYSTEM_PROMPT,
        messages,
        tools: TOOL_SPECS,
        maxOutputTokens: limits.maxOutputTokens,
      });
    } catch (err) {
      const kind = err instanceof ModelError ? err.kind : "UNEXPECTED";
      emit({ type: "error", kind, message: (err as Error).message });
      const reason =
        kind === "RATE_LIMITED"
          ? "The AI model is rate-limited right now (free tier). Please try again in a minute."
          : kind === "CONFIG"
            ? "The AI model is not configured on this server (missing API key)."
            : "The AI model is unavailable right now.";
      // A purchase captured earlier in this turn stands; never tell the user otherwise.
      const text = captured ? reason + PAID_NOTE : `${reason} Nothing was bought in this request.`;
      return { text, history: messages, events, usage, stoppedBy: "model_error" };
    }
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    emit({ type: "model", step, provider: args.adapter.provider, model: args.adapter.model, ...res.usage });
    messages.push(res.message);

    if (res.message.toolCalls.length === 0) {
      let text = res.message.text || "(no answer)";
      if (!captured && claimsPurchase(text)) {
        emit({
          type: "guard",
          rule: "UNCONFIRMED_PURCHASE_CLAIM",
          detail: "model claimed a purchase the executor did not confirm",
        });
        text += "\n\n(Note from TrueCart: no payment was made in this conversation turn.)";
      }
      emit({ type: "assistant", text });
      return { text, history: messages, events, usage, stoppedBy: "answer" };
    }

    const results: Extract<AgentMessage, { role: "tool" }>["results"] = [];
    for (const call of res.message.toolCalls) {
      emit({ type: "tool_call", name: call.name, args: call.args });
      const tool = TOOLS[call.name];
      let content: unknown;
      if (!tool) {
        content = { error: `unknown tool "${call.name}". Available: ${Object.keys(TOOLS).join(", ")}` };
        emit({ type: "guard", rule: "UNKNOWN_TOOL", detail: call.name });
      } else {
        const parsed = (tool.schema as z.ZodType).safeParse(call.args);
        if (!parsed.success) {
          content = {
            error: "invalid arguments",
            issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
          };
          emit({ type: "guard", rule: "INVALID_TOOL_ARGS", detail: call.name });
        } else {
          try {
            content = await tool.run(args.session, parsed.data as never);
          } catch (err) {
            content = { error: err instanceof ToolInputError ? err.message : "tool failed" };
          }
        }
      }
      const status = (content as { status?: string })?.status;
      if (status === "CAPTURED") captured = true;
      emit({
        type: "tool_result",
        name: call.name,
        ok: !(content as { error?: unknown })?.error,
        ...(status && { status }),
      });
      results.push({ callId: call.id, name: call.name, content });
    }
    messages.push({ role: "tool", results });

    if (usage.inputTokens + usage.outputTokens > limits.maxTurnTokens) {
      emit({ type: "guard", rule: "TOKEN_BUDGET", detail: `${usage.inputTokens + usage.outputTokens} tokens` });
      return {
        text:
          "I stopped because this request used its token budget." +
          (captured ? PAID_NOTE : " Here is what I found so far in the activity log."),
        history: messages,
        events,
        usage,
        stoppedBy: "tokens",
      };
    }
  }
  emit({ type: "guard", rule: "STEP_LIMIT", detail: `${limits.maxSteps} steps` });
  return {
    text:
      "I stopped after the maximum number of steps for one request." +
      (captured ? PAID_NOTE : " Please narrow it down."),
    history: messages,
    events,
    usage,
    stoppedBy: "steps",
  };
}
