"use client";

import { useEffect, useState } from "react";

interface CheckRow {
  field: string;
  truecart: string;
  paypal: string;
  verdict: "match" | "mismatch" | "info";
}
interface CheckResult {
  purchaseId: string;
  source: string;
  calls: { tool: string; ms: number }[];
  rows: CheckRow[];
  allMatch: boolean;
}

const VERDICT = {
  match: <span className="stamp stamp-go">Same</span>,
  mismatch: <span className="stamp stamp-stop">Differs</span>,
  info: <span className="stamp stamp-plain">Note</span>,
};

/** PayPal's own record of one purchase, read through PayPal's Agent Toolkit, next to TrueCart's ledger. */
export function PayPalCheck({
  purchaseId,
  title,
  onClose,
}: {
  purchaseId: string;
  title: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ data: CheckResult | null; error: string | null }>({ data: null, error: null });

  useEffect(() => {
    let live = true;
    fetch(`/api/ledger/${encodeURIComponent(purchaseId)}/paypal`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
        return body as CheckResult;
      })
      .then(
        (data) => live && setState({ data, error: null }),
        (err: Error) => live && setState({ data: null, error: err.message }),
      );
    return () => {
      live = false;
    };
  }, [purchaseId]);

  const { data, error } = state;
  const differs = data?.rows.filter((r) => r.verdict === "mismatch").length ?? 0;
  return (
    <section className="card fade-in mt-4 p-5" aria-label="PayPal record check" aria-busy={!data && !error}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="text-[15px] font-semibold">PayPal&apos;s own record</h3>
        <span className="text-[13px] text-ink-2">{title}</span>
        <button className="btn-link ml-auto text-[13px]" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="mt-1 max-w-[85ch] text-[12.5px] text-muted">
        Asked PayPal directly through PayPal&apos;s Agent Toolkit, separately from the payment itself. TrueCart enables
        only two of its tools here, both read-only: <span className="code">get_order</span> and{" "}
        <span className="code">get_shipment_tracking</span>.
      </p>

      {!data && !error && <p className="label mt-4">Asking PayPal…</p>}
      {error && <p className="mt-4 text-[13.5px] text-stop">{error}</p>}
      {data && (
        <>
          <p className="mt-4 text-[14px]" role="status">
            {data.allMatch ? (
              <>
                <span className="stamp stamp-go mr-2">Reconciled</span>PayPal&apos;s record agrees with the ledger.
              </>
            ) : (
              <>
                <span className="stamp stamp-stop mr-2">Check</span>
                {differs} {differs === 1 ? "field differs" : "fields differ"} from the ledger.
              </>
            )}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="label text-left">
                  <th className="hairline border-b py-2 pr-4 font-normal">Field</th>
                  <th className="hairline border-b py-2 pr-4 font-normal">TrueCart ledger</th>
                  <th className="hairline border-b py-2 pr-4 font-normal">PayPal</th>
                  <th className="hairline border-b py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.field} className="align-top">
                    <td className="hairline border-b py-2 pr-4 text-ink-2">{r.field}</td>
                    <td className="hairline code border-b py-2 pr-4 break-all">{r.truecart}</td>
                    <td className="hairline code border-b py-2 pr-4 break-all">{r.paypal}</td>
                    <td className="hairline border-b py-2 text-right">{VERDICT[r.verdict]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            {data.calls.map((c) => `${c.tool} ${(c.ms / 1000).toFixed(1)} s`).join(" · ")} · PayPal sandbox
          </p>
        </>
      )}
    </section>
  );
}
