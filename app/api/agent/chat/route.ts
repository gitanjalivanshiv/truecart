import { z } from "zod";
import { geminiAdapter } from "@/src/agent/adapters/gemini";
import { replayAdapter } from "@/src/agent/adapters/scripted";
import { runTurn, type AgentEvent } from "@/src/agent/loop";
import { saveSearch } from "@/src/agent/searchStore";
import type { ModelAdapter } from "@/src/agent/types";
import { conversation } from "@/src/server/conversations";
import { handle, json, parseBody } from "@/src/server/http";
import { allow, LIMITS } from "@/src/server/rateLimit";
import { SCENARIOS, type ScenarioId } from "@/src/server/scenarios";
import { workspace } from "@/src/server/visitor";

const Body = z.strictObject({
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(1_000),
  scenario: z.enum(["hero", "redteam"]).optional(),
});

type StreamEvent =
  | AgentEvent
  | { type: "mode"; mode: "live" | "recorded"; model: string; reason?: string }
  | { type: "done"; text: string; stoppedBy: string };

// Streams the agent's turn as server-sent events. Money only moves inside tools via the executor.
export const POST = handle(async (request: Request) => {
  const body = await parseBody(request, Body);
  if (body instanceof Response) return body;
  const { vid, db, mandate } = await workspace();

  const scenario: ScenarioId | undefined =
    body.scenario && SCENARIOS[body.scenario].prompt === body.message ? body.scenario : undefined;
  const perVisitor = allow(`agent:${vid}`, LIMITS.agentTurnsPerVisitor.limit, LIMITS.agentTurnsPerVisitor.windowMs);
  const global = perVisitor.ok
    ? allow("agent:global", LIMITS.agentTurnsGlobalPerDay.limit, LIMITS.agentTurnsGlobalPerDay.windowMs)
    : { ok: false, retryAfterSec: 0 };
  // AGENT_MODE=replay serves recorded runs for the demo requests only (tests, or if the free tier runs out).
  const liveAvailable = Boolean(process.env.GEMINI_API_KEY) && process.env.AGENT_MODE !== "replay";
  // Over the limits (or no key), only the recorded demo scenarios can run.
  if ((!perVisitor.ok || !global.ok || !liveAvailable) && !scenario) {
    const msg = !liveAvailable
      ? "The live AI model is switched off on this server. Try one of the demo requests, which replay recorded runs."
      : "You have reached the request limit for now. Try again later, or run one of the demo requests.";
    return json(
      { error: msg },
      429,
      perVisitor.retryAfterSec ? { "Retry-After": String(perVisitor.retryAfterSec) } : undefined,
    );
  }

  const convo = conversation(db, vid, body.conversationId, mandate.id);
  convo.session.onSearch = (r) =>
    saveSearch({
      owner: vid,
      query: r.query,
      quantity: r.quantity,
      rows: r.rows,
      quotes: r.quotes,
      fxSource: r.fxSource,
      markets: r.discovery.markets,
      groups: r.discovery.groups,
      via: "agent",
    });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let captured = false;
      const send = (e: StreamEvent) => {
        if (e.type === "tool_result" && e.status === "CAPTURED") captured = true;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      const run = (adapter: ModelAdapter, history = convo.history) =>
        runTurn({ adapter, session: convo.session, history, userText: body.message, onEvent: send });
      try {
        const historyBefore = convo.history;
        let adapter: ModelAdapter =
          liveAvailable && perVisitor.ok && global.ok ? geminiAdapter() : replayAdapter(SCENARIOS[scenario!].recording);
        send({
          type: "mode",
          mode: adapter.provider === "replay" ? "recorded" : "live",
          model: adapter.model,
          ...(adapter.provider === "replay" && {
            reason: liveAvailable ? "request limit reached" : "live model switched off",
          }),
        });
        let turn = await run(adapter);
        const triedToBuy = turn.events.some((e) => e.type === "tool_call" && e.name === "propose_purchase");
        // Fall back to the recording only if the live model failed before anything was proposed (never repeat a purchase).
        if (turn.stoppedBy === "model_error" && scenario && !triedToBuy) {
          adapter = replayAdapter(SCENARIOS[scenario].recording);
          send({ type: "mode", mode: "recorded", model: adapter.model, reason: "live model busy" });
          turn = await run(adapter, historyBefore);
        }
        convo.history = turn.history;
        const hint =
          turn.stoppedBy === "model_error" && !scenario && !triedToBuy
            ? `\n\nThe demo request still works when the live model is busy (it replays a recorded run): "${SCENARIOS.hero.prompt}"`
            : "";
        send({ type: "done", text: turn.text + hint, stoppedBy: turn.stoppedBy });
      } catch (err) {
        console.error(`[agent] ${(err as Error).name}: ${(err as Error).message}`);
        const text = captured
          ? "Something went wrong on our side after your purchase went through. See the Ledger for the PayPal order."
          : "Something went wrong on our side. Nothing was charged.";
        send({ type: "done", text, stoppedBy: "error" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
});
