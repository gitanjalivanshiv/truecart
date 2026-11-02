import { describe, expect, it } from "vitest";
import { geminiAdapter } from "@/src/agent/adapters/gemini";
import { ModelError, type ModelRequest } from "@/src/agent/types";

const req: ModelRequest = {
  system: "SYS",
  maxOutputTokens: 256,
  tools: [
    {
      name: "search_offers",
      description: "d",
      parameters: { type: "object", properties: { query: { type: "string", description: "q" } }, required: ["query"] },
    },
  ],
  messages: [
    { role: "user", text: "hello" },
    {
      role: "assistant",
      text: "",
      toolCalls: [{ id: "c1", name: "search_offers", args: { query: "x" } }],
      providerRaw: {
        role: "model",
        parts: [{ functionCall: { name: "search_offers", args: { query: "x" }, id: "c1" }, thoughtSignature: "SIG" }],
      },
    },
    { role: "tool", results: [{ callId: "c1", name: "search_offers", content: { offers: [] } }] },
  ],
};

function mockFetch(status: number, body: unknown) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, seen };
}

describe("gemini adapter", () => {
  it("sends system instruction, tools, function responses and replays the raw model turn (thought signature)", async () => {
    const { fetchFn, seen } = mockFetch(200, {
      candidates: [{ content: { role: "model", parts: [{ text: "hi" }] }, finishReason: "STOP" }],
    });
    await geminiAdapter({ apiKey: "k", model: "gemini-2.5-flash", fetchFn }).complete(req);
    expect(seen[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect((seen[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
    const body = JSON.parse(seen[0].init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("SYS");
    expect(body.tools[0].functionDeclarations[0].name).toBe("search_offers");
    expect(body.contents[1].parts[0].thoughtSignature).toBe("SIG");
    expect(body.contents[2]).toEqual({
      role: "user",
      parts: [{ functionResponse: { name: "search_offers", id: "c1", response: { content: { offers: [] } } } }],
    });
  });

  it("parses function calls, assigns ids, hides thoughts and counts thinking tokens", async () => {
    const { fetchFn } = mockFetch(200, {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { text: "thinking...", thought: true },
              { functionCall: { name: "a", args: {} } },
              { functionCall: { name: "a", args: { n: 2 } } },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 },
    });
    const res = await geminiAdapter({ apiKey: "k", fetchFn }).complete(req);
    expect(res.stopReason).toBe("tool_calls");
    expect(res.message.text).toBe("");
    expect(res.message.toolCalls).toHaveLength(2);
    expect(res.message.toolCalls[0].id).not.toBe(res.message.toolCalls[1].id);
    const raw = res.message.providerRaw as { parts: { functionCall?: { id: string } }[] };
    expect(raw.parts.filter((p) => p.functionCall).map((p) => p.functionCall!.id)).toEqual(
      res.message.toolCalls.map((c) => c.id),
    );
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 12 });
  });

  it.each([
    [429, "RATE_LIMITED"],
    [403, "AUTH"],
    [400, "BAD_REQUEST"],
    [503, "UNAVAILABLE"],
  ])("HTTP %i -> %s", async (status, kind) => {
    const { fetchFn } = mockFetch(status, { error: "secret request echo" });
    await expect(geminiAdapter({ apiKey: "k", fetchFn }).complete(req)).rejects.toMatchObject({
      kind,
      message: expect.not.stringContaining("secret"),
    });
  });

  it("reports a blocked prompt and a missing key", async () => {
    const { fetchFn } = mockFetch(200, { promptFeedback: { blockReason: "SAFETY" } });
    await expect(geminiAdapter({ apiKey: "k", fetchFn }).complete(req)).rejects.toMatchObject({ kind: "BLOCKED" });
    await expect(geminiAdapter({ apiKey: "", fetchFn }).complete(req)).rejects.toBeInstanceOf(ModelError);
  });
});
