// Talk to the TrueCart agent from the terminal.
//   npm run demo:chat -- "Get me a 1L insulated water bottle, delivered to the UK, under £40."
// Flags:
//   --pay              charge for real in the PayPal SANDBOX using the wallet vaulted by spike S1 (default: dry run)
//   --live-search      live Channel3 + FX (default: recorded, deterministic)
//   --record <name>    save the model's turns to fixtures/agent/<name>.json (demo fallback)
//   --replay <name>    replay recorded model turns instead of calling Gemini
// Uses a throwaway SQLite file. Sandbox only: no real money.

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { geminiAdapter } from "@/src/agent/adapters/gemini";
import { recordingAdapter, replayAdapter } from "@/src/agent/adapters/scripted";
import { runTurn } from "@/src/agent/loop";
import { newSession } from "@/src/agent/session";
import { openDatabase } from "@/src/db/database";
import { saveMandate } from "@/src/db/repositories";
import { demoMandate } from "@/src/discovery/demoMandate";
import { paypalGateway } from "@/src/executor/gateway";
import { lookupOrderViaToolkit } from "@/src/integrations/paypal/toolkit";
import { arg, load, run } from "../spikes/_lib";

run(async () => {
  const userText =
    process.argv[2] && !process.argv[2].startsWith("--")
      ? process.argv[2]
      : "Get me a 1L insulated water bottle, delivered to the UK, under £40.";
  const pay = process.argv.includes("--pay");
  const replay = arg("replay");
  const recordName = arg("record");

  const dbPath = "scripts/spikes/.out/demo-chat.db";
  rmSync(dbPath, { force: true });
  const db = openDatabase(dbPath);
  const vaultId = load<{ vaultId?: string }>("s1-vault")?.vaultId ?? null;
  if (pay && !vaultId) throw new Error("--pay needs the wallet from spike S1 (npm run spike:vault -- setup/token)");
  saveMandate(db, demoMandate(pay ? vaultId : "dry-run-wallet"), new Date());

  const base = replay ? replayAdapter(join("fixtures/agent", `${replay}.json`)) : geminiAdapter();
  const recorder = recordName ? recordingAdapter(base) : null;
  const adapter = recorder ?? base;
  const session = newSession({
    id: `cli-${Date.now()}`,
    db,
    mandateId: "demo-mandate",
    gateway: pay ? paypalGateway : null,
    paypalLookup: pay ? (orderId) => lookupOrderViaToolkit(orderId) : null,
    discoveryMode: process.argv.includes("--live-search") ? "live" : "replay",
    maskBrands: !process.argv.includes("--unmasked"),
    now: () => new Date(),
  });

  console.log(
    `\nUser: ${userText}\n(model: ${adapter.provider}/${adapter.model}; payments: ${pay ? "PayPal SANDBOX" : "dry run"})\n`,
  );
  const turn = await runTurn({
    adapter,
    session,
    history: [],
    userText,
    onEvent: (e) => {
      if (e.type === "tool_call") console.log(`  -> ${e.name} ${JSON.stringify(e.args)}`);
      if (e.type === "tool_result")
        console.log(`  <- ${e.name} ${e.ok ? "ok" : "error"}${e.status ? ` ${e.status}` : ""}`);
      if (e.type === "guard") console.log(`  !! guard ${e.rule}: ${e.detail}`);
      if (e.type === "error") console.log(`  !! ${e.kind}: ${e.message}`);
    },
  });
  console.log(
    `\nTrueCart: ${turn.text}\n\n(stopped by: ${turn.stoppedBy}; tokens in/out: ${turn.usage.inputTokens}/${turn.usage.outputTokens})`,
  );

  if (recordName && recorder && turn.stoppedBy === "answer") {
    const file = join("fixtures/agent", `${recordName}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          description: userText,
          model: `${base.provider}/${base.model}`,
          recordedAt: new Date().toISOString(),
          turns: recorder.turns,
        },
        null,
        2,
      ),
    );
    console.log(`recorded ${recorder.turns.length} model turns to ${file}`);
  }
  db.close();
});
