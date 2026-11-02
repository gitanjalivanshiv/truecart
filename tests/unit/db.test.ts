import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, transaction, type Db } from "@/src/db/database";
import {
  consumeApproval,
  getApproval,
  getMandate,
  getPurchase,
  insertApproval,
  ledgerForMandate,
  LedgerSettlementError,
  saveMandate,
  settleLedgerEntry,
} from "@/src/db/repositories";
import { requestIdFor, reserveCharge } from "@/src/db/reserveCharge";
import { createApproval } from "@/src/domain/approval";
import { agentView } from "@/src/domain/mandate";
import { committedThisMonth } from "@/src/domain/ledger";
import { money } from "@/src/domain/money";
import { intent, mandate, NOW } from "./fixtures/domain";

let db: Db;
beforeEach(() => {
  db = openDatabase(":memory:");
  saveMandate(db, mandate(), NOW);
});

const committed = () => committedThisMonth(ledgerForMandate(db, "mandate-1"), "mandate-1", "GBP", NOW);

describe("migrations", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("are idempotent across reopen", () => {
    dir = mkdtempSync(join(tmpdir(), "truecart-"));
    const path = join(dir, "t.db");
    const a = openDatabase(path);
    saveMandate(a, mandate(), NOW);
    a.close();
    const b = openDatabase(path);
    expect(getMandate(b, "mandate-1")?.id).toBe("mandate-1");
    expect((b.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
    b.close();
  });
});

describe("mandates", () => {
  it("round-trips and keeps the wallet token out of the agent view", () => {
    const m = getMandate(db, "mandate-1")!;
    expect(m.walletTokenRef).toBe("vault-token-1");
    expect(JSON.stringify(agentView(m))).not.toContain("vault-token-1");
  });

  it("stores the wallet token outside the JSON blob", () => {
    const row = db.prepare("SELECT data FROM mandates WHERE id = 'mandate-1'").get() as { data: string };
    expect(row.data).not.toContain("vault-token-1");
  });
});

describe("approvals (compare-and-set)", () => {
  it("can be consumed exactly once, and not after expiry", () => {
    const a = createApproval(intent(), "appr-1", NOW);
    insertApproval(db, a);
    expect(consumeApproval(db, "appr-1", NOW)).toBe(true);
    expect(consumeApproval(db, "appr-1", NOW)).toBe(false);
    insertApproval(db, createApproval(intent(), "appr-2", NOW));
    expect(consumeApproval(db, "appr-2", new Date(NOW.getTime() + 16 * 60_000))).toBe(false);
    expect(getApproval(db, "appr-2")?.usedAt).toBeNull();
  });
});

describe("reserveCharge", () => {
  it("AUTO: reserves the worst case and records the purchase with a deterministic request id", () => {
    const r = reserveCharge(db, { proposalId: "p1", intent: intent(), now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.purchase).toMatchObject({
      status: "RESERVED",
      authorizedVia: "AUTO",
      requestId: requestIdFor("mandate-1", "p1"),
    });
    expect(ledgerForMandate(db, "mandate-1")).toMatchObject([{ status: "PENDING", amountMinor: 3_000 }]);
  });

  it("replaying the same proposal returns the same purchase and never reserves twice", () => {
    const a = reserveCharge(db, { proposalId: "p1", intent: intent(), now: NOW });
    const b = reserveCharge(db, { proposalId: "p1", intent: intent(), now: NOW });
    expect(b).toMatchObject({ ok: true, replay: true });
    expect(a.ok && b.ok && a.purchase.id === b.purchase.id).toBe(true);
    expect(ledgerForMandate(db, "mandate-1")).toHaveLength(1);
  });

  it("NEEDS_APPROVAL without an approval writes nothing", () => {
    const r = reserveCharge(db, {
      proposalId: "p1",
      intent: intent({ landedTotal: money(8_000, "GBP"), orderAmount: money(8_000, "GBP") }),
      now: NOW,
    });
    expect(r).toMatchObject({ ok: false, reasons: expect.arrayContaining(["APPROVAL_MISSING"]) });
    expect(ledgerForMandate(db, "mandate-1")).toHaveLength(0);
  });

  it("consumes the approval atomically; a second proposal cannot reuse it", () => {
    const big = intent({ landedTotal: money(8_000, "GBP"), orderAmount: money(8_000, "GBP") });
    insertApproval(db, createApproval(big, "appr-1", NOW));
    const first = reserveCharge(db, { proposalId: "p1", intent: big, approvalId: "appr-1", now: NOW });
    expect(first).toMatchObject({ ok: true, purchase: { authorizedVia: "APPROVAL", approvalId: "appr-1" } });
    expect(getApproval(db, "appr-1")?.usedAt).not.toBeNull();

    const second = reserveCharge(db, { proposalId: "p2", intent: big, approvalId: "appr-1", now: NOW });
    expect(second).toMatchObject({ ok: false, reasons: expect.arrayContaining(["APPROVAL_USED"]) });
    expect(ledgerForMandate(db, "mandate-1")).toHaveLength(1);
  });

  it("an approval for a different cart is rejected and stays unused", () => {
    insertApproval(
      db,
      createApproval(intent({ landedTotal: money(8_000, "GBP"), orderAmount: money(8_000, "GBP") }), "appr-1", NOW),
    );
    const swapped = intent({ landedTotal: money(9_000, "GBP"), orderAmount: money(9_000, "GBP") });
    const r = reserveCharge(db, { proposalId: "p1", intent: swapped, approvalId: "appr-1", now: NOW });
    expect(r).toMatchObject({ ok: false, reasons: expect.arrayContaining(["APPROVAL_AMOUNT_MISMATCH"]) });
    expect(getApproval(db, "appr-1")?.usedAt).toBeNull();
  });

  it("a second purchase that would break the monthly cap is denied", () => {
    // £400 cap, £150 per purchase, approval above £50: approve two £140 purchases and a third.
    const each = intent({ landedTotal: money(14_000, "GBP"), orderAmount: money(14_000, "GBP") });
    for (const n of [1, 2, 3]) insertApproval(db, createApproval(each, `appr-${n}`, NOW));
    expect(reserveCharge(db, { proposalId: "p1", intent: each, approvalId: "appr-1", now: NOW }).ok).toBe(true);
    expect(reserveCharge(db, { proposalId: "p2", intent: each, approvalId: "appr-2", now: NOW }).ok).toBe(true);
    const third = reserveCharge(db, { proposalId: "p3", intent: each, approvalId: "appr-3", now: NOW });
    expect(third).toMatchObject({ ok: false, reasons: expect.arrayContaining(["EXCEEDS_MONTHLY_CAP"]) });
    expect(getApproval(db, "appr-3")?.usedAt).toBeNull();
    expect(committed()).toBe(28_000);
  });

  it("refuses an unknown mandate", () => {
    expect(reserveCharge(db, { proposalId: "p1", intent: intent({ mandateId: "nope" }), now: NOW })).toMatchObject({
      ok: false,
      reasons: ["MANDATE_NOT_FOUND"],
    });
  });
});

describe("settlement", () => {
  const reserveUsd = () => {
    // USD order: reservation = landed £49.01 + 2% slack (CEIL) = £50.00
    const r = reserveCharge(db, {
      proposalId: "p1",
      intent: intent({ orderAmount: money(6_000, "USD"), merchantCountry: "US", landedTotal: money(4_901, "GBP") }),
      now: NOW,
    });
    if (!r.ok) throw new Error("expected reservation");
    return r.purchase.id;
  };

  it("captures at or below the reservation", () => {
    const id = reserveUsd();
    settleLedgerEntry(db, id, { status: "CAPTURED", amountMinor: 4_901 }, NOW);
    expect(ledgerForMandate(db, "mandate-1")).toMatchObject([{ status: "CAPTURED", amountMinor: 4_901 }]);
  });

  it("refuses a capture above the reservation and leaves the entry pending", () => {
    const id = reserveUsd();
    expect(() => settleLedgerEntry(db, id, { status: "CAPTURED", amountMinor: 5_001 }, NOW)).toThrow(
      LedgerSettlementError,
    );
    expect(ledgerForMandate(db, "mandate-1")).toMatchObject([{ status: "PENDING", amountMinor: 5_000 }]);
  });

  it("a failed charge releases the cap; settling twice is refused", () => {
    const id = reserveUsd();
    settleLedgerEntry(db, id, { status: "FAILED" }, NOW);
    expect(committed()).toBe(0);
    expect(() => settleLedgerEntry(db, id, { status: "CAPTURED", amountMinor: 1 }, NOW)).toThrow(LedgerSettlementError);
    expect(getPurchase(db, id)?.status).toBe("RESERVED"); // purchase status is the executor's job (step 2)
  });
});

describe("transaction", () => {
  it("rolls back everything on error", () => {
    expect(() =>
      transaction(db, () => {
        insertApproval(db, createApproval(intent(), "appr-x", NOW));
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(getApproval(db, "appr-x")).toBeUndefined();
  });
});

describe("store property: committed spend never exceeds the monthly cap", () => {
  it("holds across random reserve / settle sequences against real SQLite", () => {
    const step = fc.oneof(
      fc.record({
        kind: fc.constant("buy" as const),
        landed: fc.integer({ min: 1, max: 16_000 }),
        usd: fc.boolean(),
        approve: fc.boolean(),
      }),
      fc.record({
        kind: fc.constant("settle" as const),
        pick: fc.nat(),
        bps: fc.integer({ min: 0, max: 10_000 }),
        fail: fc.boolean(),
      }),
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 25 }), (steps) => {
        const s = openDatabase(":memory:");
        saveMandate(s, mandate(), NOW);
        const pending: { id: string; reserved: number }[] = [];
        steps.forEach((st, n) => {
          if (st.kind === "buy") {
            const i = intent({
              landedTotal: money(st.landed, "GBP"),
              orderAmount: st.usd ? money(st.landed, "USD") : money(st.landed, "GBP"),
              merchantCountry: st.usd ? "US" : "GB",
            });
            let approvalId: string | undefined;
            if (st.approve) {
              approvalId = `a-${n}`;
              insertApproval(s, createApproval(i, approvalId, NOW));
            }
            const r = reserveCharge(s, { proposalId: `p-${n}`, intent: i, approvalId, now: NOW });
            if (r.ok) pending.push({ id: r.purchase.id, reserved: r.policy!.worstCaseTotalMinor! });
          } else if (pending.length > 0) {
            const [p] = pending.splice(st.pick % pending.length, 1);
            settleLedgerEntry(
              s,
              p.id,
              st.fail
                ? { status: "FAILED" }
                : { status: "CAPTURED", amountMinor: Math.floor((p.reserved * st.bps) / 10_000) },
              NOW,
            );
          }
          expect(committedThisMonth(ledgerForMandate(s, "mandate-1"), "mandate-1", "GBP", NOW)).toBeLessThanOrEqual(
            40_000,
          );
        });
        s.close();
      }),
      { numRuns: 300 },
    );
  });
});
