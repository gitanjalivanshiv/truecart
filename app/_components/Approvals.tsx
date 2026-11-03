"use client";

import Link from "next/link";
import { useState } from "react";
import { BoxHead, Stamp } from "./bits";
import { LINE_TEXT, reason } from "./text";
import type { MoneyView } from "./types";
import { post, refreshAll, useApi } from "./useApi";

interface ProposalView {
  id: string;
  status: string;
  createdAt: string;
  quantity: number;
  title: string;
  merchant: string;
  merchantCountry: string | null;
  price: string;
  landedTotal: string;
  lines: { kind: string; amount: string; estimate: boolean; basis: string }[];
  confidence: string;
  charge: MoneyView;
  decision: string;
  reasons: string[];
  worstCase: MoneyView | null;
  outcome: { status: string; code?: string; orderId?: string } | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function Request({ p }: { p: ProposalView }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "approve" | "reject") {
    setBusy(action);
    setError(null);
    try {
      await post(`/api/approvals/${p.id}`, { action });
      refreshAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <article className="sheet">
      <div className="flex items-baseline gap-3 border-b border-rule px-4 py-2">
        <span className="label">Approval request</span>
        <span className="num text-[12px] text-muted">{when(p.createdAt)}</span>
        <span className="code ml-auto text-[11px] text-muted">{p.id.slice(5, 13)}</span>
      </div>
      <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h3 className="text-[17px] font-semibold leading-snug">
            {p.title} <span className="num text-[14px] font-normal text-ink-2">× {p.quantity}</span>
          </h3>
          <div className="mt-0.5 text-[13px] text-ink-2">
            {p.merchant} · {p.merchantCountry ?? "country unknown"} · {p.price}
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[13.5px]">
            <dt className="label pt-0.5">PayPal charge</dt>
            <dd className="num">{p.charge.text}</dd>
            <dt className="label pt-0.5">Landed (est.)</dt>
            <dd className="num">{p.landedTotal}</dd>
            {p.worstCase && (
              <>
                <dt className="label pt-0.5">Counted against cap</dt>
                <dd className="num">
                  {p.worstCase.text} <span className="font-sans text-[12px] text-muted">incl. FX buffer</span>
                </dd>
              </>
            )}
            <dt className="label pt-0.5">Why you</dt>
            <dd>{p.reasons.map(reason).join(" · ")}</dd>
          </dl>
        </div>
        <table className="ruled self-start">
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.kind}>
                <td>{LINE_TEXT[l.kind] ?? l.kind}</td>
                <td className={`r num ${l.estimate ? "est" : ""}`}>{l.amount}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="r num">{p.landedTotal}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-rule px-4 py-3">
        <button className="btn btn-primary" disabled={busy !== null} onClick={() => act("approve")}>
          {busy === "approve" ? "Paying…" : `Approve and pay ${p.charge.text}`}
        </button>
        <button className="btn btn-danger" disabled={busy !== null} onClick={() => act("reject")}>
          Reject
        </button>
        <span className="ml-auto text-[12px] text-muted">
          Approving pays exactly this. Limits are checked again at payment.
        </span>
        {error && <span className="w-full text-stop">{error}</span>}
      </div>
    </article>
  );
}

export function Approvals() {
  const { data, error, loading } = useApi<ProposalView[]>("/api/approvals");
  const waiting = data?.filter((p) => p.status === "AWAITING_APPROVAL") ?? [];
  const decided = data?.filter((p) => p.status !== "AWAITING_APPROVAL" && p.status !== "EXECUTING") ?? [];
  return (
    <div className="space-y-12">
      <section>
        <BoxHead no="01" title="Waiting for you" aside={<span className="label">{waiting.length} open</span>} />
        {error && <p className="text-stop">{error}</p>}
        {loading && <p className="label">Loading…</p>}
        {!loading && waiting.length === 0 && (
          <p className="text-muted">
            Nothing to approve. Purchases above your auto-buy limit land here. Ask for more than one unit on the{" "}
            <Link href="/" className="underline underline-offset-2">
              Shop
            </Link>{" "}
            page to see one.
          </p>
        )}
        <div className="space-y-6">
          {waiting.map((p) => (
            <Request key={p.id} p={p} />
          ))}
        </div>
      </section>

      <section>
        <BoxHead no="02" title="Decided" />
        {decided.length === 0 ? (
          <p className="text-[13px] text-muted">Approved, rejected and refused requests are kept here.</p>
        ) : (
          <table className="ruled">
            <thead>
              <tr>
                <th>When</th>
                <th>Item</th>
                <th>Store</th>
                <th className="r">Landed (est.)</th>
                <th>Mandate</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((p) => (
                <tr key={p.id}>
                  <td className="num whitespace-nowrap text-[12.5px] text-muted">{when(p.createdAt)}</td>
                  <td>
                    {p.title} <span className="num text-muted">× {p.quantity}</span>
                  </td>
                  <td className="whitespace-nowrap text-ink-2">{p.merchant}</td>
                  <td className="r num">{p.landedTotal}</td>
                  <td>
                    <Stamp status={p.decision} />
                  </td>
                  <td className="text-[13px]">
                    {p.status === "REJECTED" ? (
                      <Stamp status="REJECTED" />
                    ) : p.outcome ? (
                      <>
                        <Stamp status={p.outcome.status} />{" "}
                        {p.outcome.code && <span className="code ml-1 text-[12px] text-muted">{p.outcome.code}</span>}
                      </>
                    ) : (
                      <span className="text-stop">{p.reasons.map(reason).join(" · ")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
