// Connects to a TrueCart MCP server like any outside agent would, and shops within the mandate.
//   npx tsx scripts/smoke/mcp-client.ts <base-url> <mandate-token> [--buy]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [base, token] = process.argv.slice(2);
const buy = process.argv.includes("--buy");
if (!base || !token) throw new Error("usage: mcp-client.ts <base-url> <mandate-token> [--buy]");
const body = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);

(async () => {
  const client = new Client({ name: "outside-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base.replace(/\/$/, "")}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));
  const m = body(await client.callTool({ name: "get_mandate", arguments: {} }));
  console.log(
    `mandate: ${m.per_purchase_cap} per purchase, ${m.remaining_this_month} left this month, auto-buy up to ${m.auto_buy_up_to}`,
  );
  const s = body(
    await client.callTool({ name: "search_offers", arguments: { query: "insulated water bottle 1 litre" } }),
  );
  const best = s.offers[0];
  console.log(
    `best: ${best.offer_id} ${best.store} landed ${best.landed_total_estimate} (sticker rank #${best.sticker_rank}) -> ${best.mandate_decision}`,
  );
  const deny = body(
    await client.callTool({ name: "buy_within_mandate", arguments: { offer_id: best.offer_id, quantity: 20 } }),
  );
  console.log(`20 units: ${deny.status} (${deny.mandate_reasons.join(", ")})`);
  if (buy) {
    const r = body(
      await client.callTool({ name: "buy_within_mandate", arguments: { offer_id: best.offer_id, quantity: 1 } }),
    );
    console.log(
      `1 unit: ${r.status}${r.paypal_order_id ? ` order ${r.paypal_order_id}` : ""} charged ${r.charged ?? "-"}`,
    );
  }
  await client.close();
})().catch((e) => {
  console.log("FAIL", e.message);
  process.exit(1);
});
