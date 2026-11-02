// CLI demo (SPEC day-3 exit): request -> offers across GB/US/DE -> landed-cost ranking -> policy decision.
//   npm run demo:discover -- "insulated water bottle 1 litre" [--replay] [--live] [--unmasked] [--top 12]
// Default mode follows DEMO_MODE. Brands/retailers are masked unless --unmasked.

import { discover } from "@/src/discovery/discover";
import { demoMandate } from "@/src/discovery/demoMandate";
import { rankDiscovery } from "@/src/discovery/rank";
import { toDecimalString, type Money } from "@/src/domain/money";
import { getQuotes } from "@/src/integrations/fxrates/resilient";
import { arg, run } from "../spikes/_lib";

const fmt = (m: Money) => `${toDecimalString(m)} ${m.currency}`;
const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

run(async () => {
  const query =
    process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "insulated water bottle 1 litre";
  const mode = process.argv.includes("--live") ? "live" : process.argv.includes("--replay") ? "replay" : undefined;
  const top = Number(arg("top", "12"));
  const now = new Date();

  const discovery = await discover(query, { mode });
  const fx = await getQuotes("GBP", ["USD", "EUR"], {
    mode: mode ?? (process.env.DEMO_MODE === "true" ? "replay" : "live"),
  });
  const mandate = demoMandate("dry-run-wallet", now);
  const { rows, skipped } = rankDiscovery(discovery, {
    mandate,
    ledger: [],
    quotes: fx.quotes,
    maskBrands: !process.argv.includes("--unmasked"),
    now,
  });

  console.log(`\nQuery: "${query}"   (sandbox, simulated merchants; shipping/tax/FX are ESTIMATES)`);
  for (const m of discovery.markets)
    console.log(`  ${m.country}: ${m.source}, ${m.offerCount} offers${m.note ? ` (${m.note})` : ""}`);
  console.log(`  FX: ${fx.source} ${fx.quotes.map((q) => `${q.from}->${q.to} ${q.rate} (${q.asOf})`).join(", ")}`);
  console.log(
    `  dropped: ${discovery.dropped.length}, skipped: ${skipped.length}, cross-market groups: ${discovery.groups.filter((g) => g.markets.length > 1).length}\n`,
  );

  console.log(
    `${pad("true", 5)}${pad("stkr", 5)}${pad("product", 44)}${pad("store", 12)}${pad("ctry", 9)}${pad("price", 12)}${pad("landed", 12)}${pad("conf", 7)}decision`,
  );
  for (const r of rows.slice(0, top)) {
    const reasons = r.policy.reasons.filter((x) => x !== "WITHIN_LIMITS").join(",");
    console.log(
      `${pad(`#${r.trueRank}`, 5)}${pad(`#${r.stickerRank}`, 5)}${pad(r.display.title, 44)}${pad(r.display.merchant, 12)}` +
        `${pad(`${r.offer.merchantCountry ?? "?"}${r.offer.countrySource === "locale" ? "*" : ""}`, 9)}${pad(fmt(r.offer.unitPrice), 12)}` +
        `${pad(fmt(r.total), 12)}${pad(r.confidence, 7)}${r.policy.decision}${reasons ? ` (${reasons})` : ""}`,
    );
  }
  const sticker = rows.find((r) => r.stickerRank === 1);
  const winner = rows[0];
  if (sticker && winner && winner.offerId !== sticker.offerId && winner.vsStickerLeader) {
    const gbp = (minor: number) =>
      `${minor < 0 ? "-" : "+"}${toDecimalString({ amountMinor: Math.abs(minor), currency: winner.total.currency })}`;
    console.log(`\nCheapest sticker ranks #${sticker.trueRank} by landed cost. The true #1 vs it (code-computed):`);
    console.log(
      `  total ${gbp(winner.vsStickerLeader.totalDeltaMinor)} ${winner.total.currency}: ` +
        winner.vsStickerLeader.drivers.map((d) => `${d.kind} ${gbp(d.deltaMinor)}`).join(", "),
    );
  }
  console.log("  * country inferred from the search market, not the store domain");
});
