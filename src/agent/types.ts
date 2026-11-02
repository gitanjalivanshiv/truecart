// Provider-neutral agent types. Any model provider plugs in through ModelAdapter; the loop, tools and
// safety rules never depend on a provider.

export interface ToolCall {
  id: string;
  name: string;
  args: unknown; // untrusted until validated by the tool's zod schema
}

export type AgentMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; providerRaw?: unknown }
  | { role: "tool"; results: { callId: string; name: string; content: unknown }[] };

/** JSON-schema subset every provider accepts: flat objects of string/integer/boolean properties. */
export interface ToolParameters {
  type: "object";
  properties: Record<
    string,
    { type: "string" | "integer" | "boolean"; description: string; minimum?: number; maximum?: number }
  >;
  required: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface ModelRequest {
  system: string;
  messages: AgentMessage[];
  tools: ToolSpec[];
  maxOutputTokens: number;
}

export interface ModelResponse {
  message: Extract<AgentMessage, { role: "assistant" }>;
  usage: { inputTokens: number; outputTokens: number };
  stopReason: "tool_calls" | "end" | "max_tokens" | "blocked";
}

export interface ModelAdapter {
  readonly provider: string;
  readonly model: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

export class ModelError extends Error {
  override name = "ModelError";
  constructor(
    readonly kind: "RATE_LIMITED" | "AUTH" | "BAD_REQUEST" | "BLOCKED" | "TIMEOUT" | "UNAVAILABLE" | "CONFIG",
    message: string,
  ) {
    super(message);
  }
}
