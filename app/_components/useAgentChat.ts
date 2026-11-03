"use client";

import { useRef, useState } from "react";
import { refreshAll } from "./useApi";

type Ev =
  | { type: "mode"; mode: "live" | "recorded"; model: string; reason?: string }
  | { type: "model"; inputTokens: number; outputTokens: number }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; status?: string }
  | { type: "guard"; rule: string; detail: string }
  | { type: "error"; kind: string; message: string }
  | { type: "assistant"; text: string }
  | { type: "done"; text: string; stoppedBy: string };

export interface Step {
  at: Date;
  text: string;
  status?: string;
  tone?: "stop" | "muted";
}

const GUARD_TEXT: Record<string, (d: string) => string> = {
  UNKNOWN_TOOL: (d) => `Refused a tool that does not exist: ${d}`,
  INVALID_TOOL_ARGS: (d) => `Rejected invalid arguments for ${d}`,
  UNCONFIRMED_PURCHASE_CLAIM: () => "Corrected a claim that a purchase happened",
  STEP_LIMIT: (d) => `Stopped at the step limit (${d})`,
  TOKEN_BUDGET: (d) => `Stopped at the token budget (${d})`,
};

function describeCall(name: string, a: Record<string, unknown>): string {
  switch (name) {
    case "search_offers":
      return `Searched UK, US and German shops for “${a.query}”${a.quantity && a.quantity !== 1 ? ` (×${a.quantity})` : ""}`;
    case "explain_ranking":
      return `Broke down the landed cost of ${a.ref}`;
    case "check_policy":
      return `Checked ${a.ref} ×${a.quantity} against your mandate`;
    case "propose_purchase":
      return `Proposed buying ${a.ref} ×${a.quantity}`;
    case "get_order_status":
      return "Looked up the order status";
    case "get_mandate_summary":
      return "Read your mandate";
    case "track_deliveries":
      return "Checked your deliveries";
    default:
      return `Tried “${name}”`;
  }
}

export const time = (d: Date) =>
  d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function useAgentChat() {
  const convo = useRef<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<{ who: "you" | "agent"; text: string }[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [mode, setMode] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [tokens, setTokens] = useState(0);

  async function send(message: string, scenario?: "hero" | "redteam") {
    if (!message.trim() || busy) return;
    convo.current ??= crypto.randomUUID();
    setBusy(true);
    setTurns((t) => [...t, { who: "you", text: message }]);
    setInput("");
    const addStep = (s: Omit<Step, "at">) => setSteps((x) => [...x, { ...s, at: new Date() }]);
    let pendingCall: string | null = null;

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convo.current, message, ...(scenario && { scenario }) }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setTurns((t) => [
          ...t,
          { who: "agent", text: body.error ?? "The agent is unavailable right now. Nothing was bought." },
        ]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          if (!chunk.startsWith("data: ")) continue;
          const e = JSON.parse(chunk.slice(6)) as Ev;
          if (e.type === "mode") {
            setMode(
              e.mode === "live"
                ? `${e.model} · live`
                : `recorded run of ${e.model.replace(/^replay:(gemini\/)?/, "")} · ${e.reason}`,
            );
            if (e.mode === "recorded")
              addStep({
                text: `Live model unavailable (${e.reason}); replaying a recorded run. Tools, prices and payments still run live.`,
                tone: "muted",
              });
          } else if (e.type === "model") setTokens((n) => n + e.inputTokens + e.outputTokens);
          else if (e.type === "tool_call") {
            pendingCall = describeCall(e.name, e.args);
            if (e.name === "search_offers") setSearched(true);
          } else if (e.type === "tool_result") {
            addStep({ text: pendingCall ?? e.name, status: e.status ?? (e.ok ? undefined : "FAILED") });
            pendingCall = null;
          } else if (e.type === "guard")
            addStep({ text: (GUARD_TEXT[e.rule] ?? ((d: string) => `${e.rule}: ${d}`))(e.detail), tone: "stop" });
          else if (e.type === "error")
            addStep({ text: `Model error: ${e.kind.toLowerCase().replaceAll("_", " ")}`, tone: "stop" });
          else if (e.type === "done") setTurns((t) => [...t, { who: "agent", text: e.text }]);
        }
      }
    } catch {
      setTurns((t) => [
        ...t,
        { who: "agent", text: "Connection lost. Nothing was bought unless it shows below as Paid." },
      ]);
    } finally {
      setBusy(false);
      refreshAll();
    }
  }

  return { send, busy, turns, steps, mode, searched, tokens, input, setInput };
}
