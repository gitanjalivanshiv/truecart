// S6 — PayPal hosted sandbox MCP: connect with a client-credentials bearer token, list tools, note token lifetime.
// Docs: developer.paypal.com/ai-tools/mcp-server (sandbox streamable HTTP: https://mcp.sandbox.paypal.com/http)
// Read-only: lists tools, calls nothing.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { assertSandboxUrl, PAYPAL_SANDBOX_MCP_URL } from "@/src/config/sandbox";
import { getAccessToken } from "@/src/integrations/paypal/client";
import { requireEnv, run, save, show } from "./_lib";

run(async () => {
  requireEnv("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET");
  const base = assertSandboxUrl(PAYPAL_SANDBOX_MCP_URL, "mcp");
  const token = await getAccessToken({ force: true });
  const headers = { Authorization: `Bearer ${token.token}` };
  const result: Record<string, unknown> = {
    tokenExpiresInSeconds: token.expiresInSeconds,
    tokenExpiresInHours: +(token.expiresInSeconds / 3600).toFixed(2),
  };

  for (const [transport, make] of [
    ["streamable-http", () => new StreamableHTTPClientTransport(new URL(`${base}/http`), { requestInit: { headers } })],
    [
      "sse",
      () =>
        new SSEClientTransport(new URL(`${base}/sse`), {
          requestInit: { headers },
          eventSourceInit: {
            fetch: (u, i) => fetch(u, { ...i, headers: { ...(i?.headers as Record<string, string>), ...headers } }),
          },
        }),
    ],
  ] as const) {
    const client = new Client({ name: "truecart-spike", version: "0.0.1" });
    const t0 = Date.now();
    try {
      await client.connect(make());
      const { tools } = await client.listTools();
      result[transport] = {
        ok: true,
        ms: Date.now() - t0,
        toolCount: tools.length,
        tools: tools.map((t) => t.name).sort(),
      };
      await client.close();
      break; // first working transport is enough
    } catch (err) {
      result[transport] = { ok: false, ms: Date.now() - t0, error: (err as Error).message.slice(0, 300) };
    }
  }
  save("s6-mcp", result);
  show("S6 results", result);
});
