// S4b — Keyless preview via Channel3's free-tier MCP (https://mcp.trychannel3.com/, "no API key required").
// Used only to probe multi-locale behaviour before we have an API key. Read-only.
//   npm run spike:channel3-mcp -- [--query "insulated water bottle 1 litre"] [--list-only]

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { arg, run, save } from "./_lib";

run(async () => {
  const client = new Client({ name: "truecart-spike", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("https://mcp.trychannel3.com/")));
  const { tools } = await client.listTools();
  console.log(
    JSON.stringify(
      tools.map((t) => ({ name: t.name, params: Object.keys((t.inputSchema as { properties?: object }).properties ?? {}) })),
      null,
      2,
    ),
  );
  if (process.argv.includes("--list-only")) return void (await client.close());

  const search = tools.find((t) => /search/i.test(t.name) && !/image|brand|categor|website/i.test(t.name));
  if (!search) throw new Error("no search tool exposed");
  const props = Object.keys((search.inputSchema as { properties?: object }).properties ?? {});
  const query = arg("query", "insulated stainless steel water bottle 1 litre")!;
  const out: Record<string, unknown> = { tool: search.name, params: props };
  for (const [country, currency] of [["GB", "GBP"], ["US", "USD"], ["DE", "EUR"]]) {
    const args: Record<string, unknown> = { query };
    if (props.includes("country")) args.country = country;
    if (props.includes("currency")) args.currency = currency;
    if (props.includes("config")) args.config = { country, currency };
    if (props.includes("limit")) args.limit = 10;
    const res = await client.callTool({ name: search.name, arguments: args });
    out[country] = res.content;
  }
  save("s4b-channel3-mcp", out);
  console.log(`saved scripts/spikes/.out/s4b-channel3-mcp.json`);
  await client.close();
});
