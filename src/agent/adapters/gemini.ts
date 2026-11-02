// Gemini adapter over REST generateContent (checked 2026-11-02:
// POST /v1beta/models/{model}:generateContent, header x-goog-api-key, parts[].functionCall {name,args,id},
// results sent back as functionResponse {name,response,id}). The model's raw content (including any
// thoughtSignature) is replayed verbatim in later turns, as Gemini 3 models require.
// Free tier note: Google may use free-tier inputs to improve its products. TrueCart sends sandbox data only.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ModelError, type AgentMessage, type ModelAdapter, type ModelRequest, type ModelResponse } from "../types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const Part = z.looseObject({
  text: z.string().optional(),
  thought: z.boolean().optional(),
  functionCall: z
    .looseObject({ name: z.string(), args: z.record(z.string(), z.unknown()).optional(), id: z.string().optional() })
    .optional(),
});
const Response = z.looseObject({
  candidates: z
    .array(
      z.looseObject({
        content: z.looseObject({ role: z.string().optional(), parts: z.array(Part).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.looseObject({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z
    .looseObject({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
    })
    .optional(),
});

function toContents(messages: AgentMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", parts: [{ text: m.text }] };
    if (m.role === "assistant") {
      if (m.providerRaw) return m.providerRaw; // exact replay, keeps thought signatures
      const parts: unknown[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const c of m.toolCalls) parts.push({ functionCall: { name: c.name, args: c.args, id: c.id } });
      return { role: "model", parts };
    }
    return {
      role: "user",
      parts: m.results.map((r) => ({
        functionResponse: { name: r.name, id: r.callId, response: { content: r.content } },
      })),
    };
  });
}

export function geminiAdapter(
  opts: { apiKey?: string; model?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {},
): ModelAdapter {
  const model = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  if (!/^[a-z0-9.-]+$/.test(model)) throw new ModelError("CONFIG", "invalid GEMINI_MODEL");
  return {
    provider: "gemini",
    model,
    async complete(req: ModelRequest): Promise<ModelResponse> {
      const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
      if (!apiKey) throw new ModelError("CONFIG", "GEMINI_API_KEY is not set");
      let res: globalThis.Response;
      try {
        res = await (opts.fetchFn ?? fetch)(`${BASE}/models/${model}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: toContents(req.messages),
            tools: [
              {
                functionDeclarations: req.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                })),
              },
            ],
            toolConfig: { functionCallingConfig: { mode: "AUTO" } },
            generationConfig: { maxOutputTokens: req.maxOutputTokens, temperature: 0.2 },
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
        });
      } catch (err) {
        throw new ModelError(
          (err as Error).name === "TimeoutError" ? "TIMEOUT" : "UNAVAILABLE",
          "Gemini request failed",
        );
      }
      if (!res.ok) {
        // Never echo the body: it can include the request.
        const kind =
          res.status === 429
            ? "RATE_LIMITED"
            : res.status === 401 || res.status === 403
              ? "AUTH"
              : res.status >= 500
                ? "UNAVAILABLE"
                : "BAD_REQUEST";
        throw new ModelError(kind, `Gemini returned ${res.status}`);
      }
      const data = Response.parse(await res.json());
      if (data.promptFeedback?.blockReason)
        throw new ModelError("BLOCKED", `Gemini blocked the prompt (${data.promptFeedback.blockReason})`);
      const cand = data.candidates?.[0];
      const parts = cand?.content?.parts ?? [];
      const text = parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join("")
        .trim();
      const toolCalls = parts
        .filter((p) => p.functionCall)
        .map((p) => ({
          id: p.functionCall!.id ?? `call_${randomUUID()}`,
          name: p.functionCall!.name,
          args: p.functionCall!.args ?? {},
        }));
      // Replay the model turn as returned, but make sure each functionCall carries the id we use (paired by position).
      let callIndex = 0;
      const raw = cand?.content
        ? {
            ...cand.content,
            role: "model",
            parts: (cand.content.parts ?? []).map((p) =>
              p.functionCall ? { ...p, functionCall: { ...p.functionCall, id: toolCalls[callIndex++].id } } : p,
            ),
          }
        : undefined;
      const finish = cand?.finishReason ?? "STOP";
      return {
        message: { role: "assistant", text, toolCalls, providerRaw: raw },
        usage: {
          inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0),
        },
        stopReason: toolCalls.length
          ? "tool_calls"
          : finish === "MAX_TOKENS"
            ? "max_tokens"
            : finish === "SAFETY"
              ? "blocked"
              : "end",
      };
    },
  };
}
