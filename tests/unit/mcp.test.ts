import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createAgentToken, listAgentTokens, resolveAgentToken, revokeAgentToken } from "@/src/db/agentTokens";
import { openDatabase, type Db } from "@/src/db/database";
import { ledgerForMandate, saveMandate } from "@/src/db/repositories";
import { demoMandate } from "@/src/discovery/demoMandate";
import type { PayPalGateway, VaultedOrderRequest } from "@/src/executor/gateway";
import { buildMcpServer } from "@/src/mcp/server";

const NOW = new Date("2026-11-15T12:00:00Z");
let db: Db;
let calls: VaultedOrderRequest[];
const gateway: PayPalGateway = {
  async createVaultedOrder(req) {
    calls.push(req);
    return {
      orderId: "ORDER-1",
      orderStatus: "COMPLETED",
      capture: { id: "CAP-1", status: "COMPLETED", amount: { currency_code: req.currency, value: req.value } },
      raw: {},
    };
  },
  async getOrder() {
    throw new Error("unused");
  },
};

async function connect(tokenId = "tok_test") {
  const server = buildMcpServer({
    db,
    mandateId: "demo-mandate",
    tokenId,
    gateway,
    discoveryMode: "replay",
    maskBrands: true,
    now: () => NOW,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test-agent", version: "0" });
  await client.connect(b);
  return client;
}
const body = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);

beforeEach(() => {
  db = openDatabase(":memory:");
  saveMandate(db, demoMandate("vault-1", NOW), NOW);
  calls = [];
});

describe("TrueCart MCP server", () => {
  it("exposes exactly the four mandate-scoped tools", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "buy_within_mandate",
      "explain_offer",
      "get_mandate",
      "search_offers",
    ]);
    expect(tools.find((t) => t.name === "search_offers")?.annotations?.readOnlyHint).toBe(true);
  });

  it("searches, explains and buys within the mandate through the shared purchase path", async () => {
    const c = await connect();
    const search = body(
      await c.callTool({ name: "search_offers", arguments: { query: "insulated water bottle 1 litre" } }),
    );
    expect(search._note).toMatch(/UNTRUSTED/);
    const best = search.offers[0];
    expect(best).toMatchObject({ true_rank: 1, mandate_decision: "AUTO" });
    expect(
      body(await c.callTool({ name: "explain_offer", arguments: { offer_id: best.offer_id } })).lines.length,
    ).toBeGreaterThan(1);

    const bought = body(
      await c.callTool({ name: "buy_within_mandate", arguments: { offer_id: best.offer_id, quantity: 1 } }),
    );
    expect(bought).toMatchObject({ status: "CAPTURED", paypal_order_id: "ORDER-1" });
    expect(calls).toHaveLength(1);
    expect(ledgerForMandate(db, "demo-mandate")).toMatchObject([{ status: "CAPTURED" }]);
  });

  it("an outside agent gets no more than the mandate allows: 20 units are denied, above the auto-buy limit waits for a person", async () => {
    const c = await connect();
    const search = body(
      await c.callTool({ name: "search_offers", arguments: { query: "insulated water bottle 1 litre" } }),
    );
    const id = search.offers[0].offer_id;
    expect(
      body(await c.callTool({ name: "buy_within_mandate", arguments: { offer_id: id, quantity: 20 } })),
    ).toMatchObject({
      status: "DENIED",
      mandate_reasons: expect.arrayContaining(["QUANTITY_EXCEEDS_LIMIT"]),
    });
    expect(
      body(await c.callTool({ name: "buy_within_mandate", arguments: { offer_id: id, quantity: 3 } })),
    ).toMatchObject({ status: "AWAITING_APPROVAL" });
    expect(calls).toHaveLength(0);
  });

  it("refuses offers it never returned and unknown arguments", async () => {
    const c = await connect();
    const r = await c.callTool({
      name: "buy_within_mandate",
      arguments: { offer_id: "off_doesnotexist", quantity: 1 },
    });
    expect(r.isError).toBe(true);
    const bad = await c.callTool({ name: "buy_within_mandate", arguments: { offer_id: "x", quantity: 0 } });
    expect(bad.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("keeps each token's searches separate", async () => {
    const a = await connect("tok_a");
    const b = await connect("tok_b");
    const id = body(await a.callTool({ name: "search_offers", arguments: { query: "insulated water bottle 1 litre" } }))
      .offers[0].offer_id;
    expect((await b.callTool({ name: "buy_within_mandate", arguments: { offer_id: id, quantity: 1 } })).isError).toBe(
      true,
    );
  });
});

describe("mandate tokens", () => {
  it("resolve only while active, are stored hashed, and are revocable", () => {
    const { id, token } = createAgentToken(db, "demo-mandate", "assistant", NOW);
    expect(token).toMatch(/^tc_mcp_[A-Za-z0-9_-]{43}$/);
    expect(resolveAgentToken(db, token)).toEqual({ tokenId: id, mandateId: "demo-mandate" });
    expect(resolveAgentToken(db, `${token.slice(0, -1)}x`)).toBeNull();
    expect(resolveAgentToken(db, "Bearer nonsense")).toBeNull();
    const raw = db.prepare("SELECT token_hash FROM agent_tokens").get() as { token_hash: string };
    expect(raw.token_hash).not.toContain(token.slice(7, 30));
    expect(listAgentTokens(db, "demo-mandate")[0]).toMatchObject({
      label: "assistant",
      hint: token.slice(-4),
      revokedAt: null,
    });
    expect(revokeAgentToken(db, id, "other-mandate")).toBe(false);
    expect(revokeAgentToken(db, id, "demo-mandate")).toBe(true);
    expect(resolveAgentToken(db, token)).toBeNull();
  });
});
