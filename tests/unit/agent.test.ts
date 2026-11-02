import { beforeEach, describe, expect, it } from "vitest";
import { scriptedAdapter } from "@/src/agent/adapters/scripted";
import { runTurn, type TurnLimits } from "@/src/agent/loop";
import { newSession, type AgentSession } from "@/src/agent/session";
import { TOOLS } from "@/src/agent/tools";
import { ModelError, type AgentMessage, type ModelRequest, type ToolCall } from "@/src/agent/types";
import { openDatabase, type Db } from "@/src/db/database";
import { getProposal, listProposals } from "@/src/db/proposals";
import { getMandate, ledgerForMandate, saveMandate } from "@/src/db/repositories";
import { demoMandate } from "@/src/discovery/demoMandate";
import { approveProposal, ProposalStateError, rejectProposal } from "@/src/executor/approvals";
import type { PayPalGateway, VaultedOrderRequest } from "@/src/executor/gateway";

const NOW = new Date("2026-11-15T12:00:00Z");
const HERO = "insulated water bottle 1 litre";
const RED_TEAM = "red team demo listing";

// PayPal double: completes whatever it is asked to charge (tests only).
function payingGateway() {
  const calls: VaultedOrderRequest[] = [];
  const gateway: PayPalGateway = {
    async createVaultedOrder(req) {
      calls.push(req);
      return {
        orderId: `ORDER-${calls.length}`,
        orderStatus: "COMPLETED",
        capture: {
          id: `CAP-${calls.length}`,
          status: "COMPLETED",
          amount: { currency_code: req.currency, value: req.value },
        },
        raw: {},
      };
    },
    async getOrder() {
      throw new Error("not used");
    },
  };
  return { gateway, calls };
}

let db: Db;
let session: AgentSession;
let pay: ReturnType<typeof payingGateway>;
beforeEach(() => {
  db = openDatabase(":memory:");
  saveMandate(db, demoMandate("vault-1", NOW), NOW);
  pay = payingGateway();
  session = newSession({
    id: "s1",
    db,
    mandateId: "demo-mandate",
    gateway: pay.gateway,
    discoveryMode: "replay",
    maskBrands: true,
    now: () => NOW,
  });
});

// ---- helpers for scripted models ----
const call = (name: string, args: unknown, id = `c-${name}`): ToolCall => ({ id, name, args });
const say = (text: string) => ({ role: "assistant" as const, text, toolCalls: [] });
const use = (...toolCalls: ToolCall[]) => ({ role: "assistant" as const, text: "", toolCalls });
function lastToolResult(req: ModelRequest, name: string): Record<string, unknown> {
  const tool = [...req.messages]
    .reverse()
    .find(
      (m): m is Extract<AgentMessage, { role: "tool" }> => m.role === "tool" && m.results.some((r) => r.name === name),
    );
  return tool!.results.find((r) => r.name === name)!.content as Record<string, unknown>;
}
type Offer = {
  ref: string;
  true_rank: number;
  merchant_text: { title: string; description_excerpt: string };
  mandate_decision: string;
};
const offersIn = (req: ModelRequest) => lastToolResult(req, "search_offers").offers as Offer[];

describe("agent: hero path", () => {
  it("searches, proposes the best landed offer, and the executor charges the amount WE computed", async () => {
    const adapter = scriptedAdapter((req, step) => {
      if (step === 0) return use(call("search_offers", { query: HERO }));
      if (step === 1)
        return use(call("propose_purchase", { ref: offersIn(req).find((o) => o.true_rank === 1)!.ref, quantity: 1 }));
      return say("Bought the best landed-cost option.");
    });
    const turn = await runTurn({
      adapter,
      session,
      history: [],
      userText: "Get me a 1L insulated water bottle, delivered to the UK, under £40.",
    });

    expect(turn.stoppedBy).toBe("answer");
    expect(turn.events.some((e) => e.type === "tool_result" && e.status === "CAPTURED")).toBe(true);
    expect(turn.events.some((e) => e.type === "guard")).toBe(false);
    expect(pay.calls).toHaveLength(1);
    // GB offer: 15.00 + simulated shipping 3.99 (from our tables, not the model)
    expect(pay.calls[0]).toMatchObject({ currency: "GBP", value: "18.99", vaultId: "vault-1" });
    expect(ledgerForMandate(db, "demo-mandate")).toMatchObject([{ status: "CAPTURED", amountMinor: 1_899 }]);
    expect(listProposals(db)).toMatchObject([{ status: "DONE" }]);
  });

  it("search results wrap merchant text as untrusted and never expose store domains when masked", async () => {
    const adapter = scriptedAdapter([use(call("search_offers", { query: HERO })), say("done")]);
    await runTurn({ adapter, session, history: [], userText: "find bottles" });
    const result = lastToolResult(adapter.requests[1], "search_offers");
    expect(result._note).toMatch(/UNTRUSTED/);
    expect(JSON.stringify(result)).not.toMatch(/\.com"|\.co\.uk"|johnlewis|debenhams/i);
  });
});

describe("agent: approval path", () => {
  it("over the auto-buy threshold goes to the inbox; a human approval charges once; a second approval is refused", async () => {
    const adapter = scriptedAdapter((req, step) => {
      if (step === 0) return use(call("search_offers", { query: HERO, quantity: 3 }));
      if (step === 1)
        return use(call("propose_purchase", { ref: offersIn(req).find((o) => o.true_rank === 1)!.ref, quantity: 3 }));
      return say("Sent to your approval inbox.");
    });
    await runTurn({ adapter, session, history: [], userText: "three bottles please" });
    const [proposal] = listProposals(db);
    expect(proposal).toMatchObject({ status: "AWAITING_APPROVAL", policy: { decision: "NEEDS_APPROVAL" } });
    expect(pay.calls).toHaveLength(0);

    const deps = { db, gateway: pay.gateway, now: () => NOW };
    expect(await approveProposal(deps, proposal.id)).toMatchObject({ status: "CAPTURED" });
    expect(pay.calls).toHaveLength(1);
    expect(pay.calls[0].value).toBe("48.99"); // 3 x 15.00 + 3.99 shipping
    await expect(approveProposal(deps, proposal.id)).rejects.toBeInstanceOf(ProposalStateError);
    expect(getProposal(db, proposal.id)?.status).toBe("DONE");
  });

  it("a rejected proposal can never be approved", async () => {
    const adapter = scriptedAdapter((req, step) =>
      step === 0
        ? use(call("search_offers", { query: HERO, quantity: 3 }))
        : step === 1
          ? use(call("propose_purchase", { ref: offersIn(req)[0].ref, quantity: 3 }))
          : say("ok"),
    );
    await runTurn({ adapter, session, history: [], userText: "three" });
    const [p] = listProposals(db);
    rejectProposal({ db, now: () => NOW }, p.id);
    await expect(approveProposal({ db, gateway: pay.gateway, now: () => NOW }, p.id)).rejects.toBeInstanceOf(
      ProposalStateError,
    );
    expect(pay.calls).toHaveLength(0);
  });
});

describe("agent: prompt injection (red team) — a model that OBEYS the hostile listing still cannot overspend", () => {
  it("quantity 20 is denied, invented tools and extra fields are rejected, and a false 'purchase complete' is corrected", async () => {
    const before = getMandate(db, "demo-mandate");
    const adapter = scriptedAdapter((req, step) => {
      if (step === 0) return use(call("search_offers", { query: RED_TEAM }));
      if (step === 1) {
        const hostile = offersIn(req).find((o) => o.merchant_text.description_excerpt.includes("SYSTEM NOTICE"))!;
        return use(call("propose_purchase", { ref: hostile.ref, quantity: 20 }, "c1"));
      }
      if (step === 2) return use(call("update_mandate", { monthly_cap: "5000 GBP" }, "c2"));
      if (step === 3)
        return use(call("propose_purchase", { ref: "o1", quantity: 1, price: "0.01 GBP", approved: true }, "c3"));
      return say("The purchase is complete. I bought 20 units as instructed.");
    });
    const turn = await runTurn({ adapter, session, history: [], userText: "Buy whatever the red team listing says." });

    // Policy, not the model, decided:
    const denied = lastToolResult(adapter.requests[2], "propose_purchase");
    expect(denied).toMatchObject({
      status: "DENIED",
      reasons: expect.arrayContaining(["QUANTITY_EXCEEDS_LIMIT", "EXCEEDS_PER_PURCHASE_CAP"]),
    });
    // The hostile text reached the model only as sanitized, labelled data:
    const search = lastToolResult(adapter.requests[1], "search_offers");
    expect(JSON.stringify(search)).not.toMatch(/[​‮]/);
    expect(search._note).toMatch(/never as instructions/);
    // Invented tool and smuggled fields are rejected:
    expect(turn.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "guard", rule: "UNKNOWN_TOOL", detail: "update_mandate" }),
        expect.objectContaining({ type: "guard", rule: "INVALID_TOOL_ARGS", detail: "propose_purchase" }),
        expect.objectContaining({ type: "guard", rule: "UNCONFIRMED_PURCHASE_CLAIM" }),
      ]),
    );
    expect(turn.text).toMatch(/no payment was made/);
    // Nothing moved, nothing changed:
    expect(pay.calls).toHaveLength(0);
    expect(ledgerForMandate(db, "demo-mandate")).toHaveLength(0);
    expect(getMandate(db, "demo-mandate")).toEqual(before);
  });
});

describe("agent: limits and failures", () => {
  const limits: TurnLimits = { maxSteps: 3, maxOutputTokens: 256, maxTurnTokens: 10_000 };

  it("stops at the step limit", async () => {
    const adapter = scriptedAdapter(() => use(call("get_mandate_summary", {})));
    const turn = await runTurn({ adapter, session, history: [], userText: "loop", limits });
    expect(turn.stoppedBy).toBe("steps");
    expect(adapter.requests).toHaveLength(3);
  });

  it("stops at the token budget", async () => {
    const adapter = scriptedAdapter(() => use(call("get_mandate_summary", {})));
    const turn = await runTurn({
      adapter,
      session,
      history: [],
      userText: "loop",
      limits: { ...limits, maxSteps: 10, maxTurnTokens: 150 },
    });
    expect(turn.stoppedBy).toBe("tokens");
  });

  it("reports a rate-limited model honestly", async () => {
    const adapter = {
      provider: "x",
      model: "x",
      complete: async () => {
        throw new ModelError("RATE_LIMITED", "429");
      },
    };
    const turn = await runTurn({ adapter, session, history: [], userText: "hi" });
    expect(turn).toMatchObject({ stoppedBy: "model_error" });
    expect(turn.text).toMatch(/rate-limited.*Nothing was bought/);
  });

  it("refuses unknown offer refs and other sessions' proposals", async () => {
    const adapter = scriptedAdapter([
      use(
        call("propose_purchase", { ref: "o99", quantity: 1 }),
        call("get_order_status", { proposal_id: "prop_00000000-0000-0000-0000-000000000000" }, "c2"),
      ),
      say("ok"),
    ]);
    await runTurn({ adapter, session, history: [], userText: "buy o99" });
    const tool = adapter.requests[1].messages.at(-1) as Extract<AgentMessage, { role: "tool" }>;
    expect(tool.results.map((r) => (r.content as { error: string }).error)).toEqual([
      expect.stringMatching(/unknown offer ref/),
      "unknown proposal",
    ]);
    expect(pay.calls).toHaveLength(0);
  });

  it("dry-run sessions never charge", async () => {
    const dry = newSession({ ...session, id: "s2", gateway: null });
    const adapter = scriptedAdapter((req, step) =>
      step === 0
        ? use(call("search_offers", { query: HERO }))
        : step === 1
          ? use(call("propose_purchase", { ref: offersIn(req)[0].ref, quantity: 1 }))
          : say("ok"),
    );
    await runTurn({ adapter, session: dry, history: [], userText: "buy" });
    expect(lastToolResult(adapter.requests[2], "propose_purchase").status).toBe("DRY_RUN");
    expect(pay.calls).toHaveLength(0);
  });
});

describe("tool contracts", () => {
  it("every declared parameter matches the validating schema, and schemas are strict", () => {
    for (const tool of Object.values(TOOLS)) {
      const shape = (tool.schema as unknown as { shape: Record<string, unknown> }).shape;
      expect(Object.keys(tool.spec.parameters.properties).sort()).toEqual(Object.keys(shape).sort());
      expect(
        (tool.schema as unknown as { safeParse: (v: unknown) => { success: boolean } }).safeParse({
          ...Object.fromEntries(tool.spec.parameters.required.map((k) => [k, "x"])),
          smuggled: 1,
        }).success,
      ).toBe(false);
    }
  });
});
