import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveAgentToken } from "@/src/db/agentTokens";
import { getDb } from "@/src/db/instance";
import { discoveryMode } from "@/src/discovery/discover";
import { paypalGateway } from "@/src/executor/gateway";
import { brandMaskingEnabled } from "@/src/integrations/channel3/mask";
import { buildMcpServer } from "@/src/mcp/server";
import { allow } from "@/src/server/rateLimit";

// TrueCart MCP server (streamable HTTP, stateless). Authorization: Bearer <mandate token from the Mandate page>.
async function handleMcp(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const db = getDb();
  const who = resolveAgentToken(db, token);
  if (!who) {
    return Response.json(
      { error: "A TrueCart mandate token is required (Mandate page > Connect an agent)." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="truecart"' } },
    );
  }
  if (!allow(`mcp:${who.tokenId}`, 60, 10 * 60_000).ok)
    return Response.json({ error: "Too many requests." }, { status: 429 });

  const server = buildMcpServer({
    db,
    ...who,
    gateway: paypalGateway,
    discoveryMode: discoveryMode(),
    maskBrands: brandMaskingEnabled(),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // Stateless: one server per request.
    void server.close();
  }
}

export const POST = handleMcp;
export const GET = handleMcp;
export const DELETE = handleMcp;
