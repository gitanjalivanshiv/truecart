"use client";

import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo, useState } from "react";
import { BoxHead, Stamp, Waterfall, WaterfallKey, type LineView } from "./bits";
import { gridTheme, GridProvider } from "./grid";
import { LINE_TEXT, reason } from "./text";
import type { MoneyView } from "./types";
import { post, refreshAll, useApi } from "./useApi";

interface Row {
  offerId: string;
  title: string;
  store: string;
  market: string;
  merchantCountry: string | null;
  countrySource: "domain" | "locale" | "unknown";
  price: MoneyView;
  sticker: MoneyView;
  landed: MoneyView;
  charged: MoneyView;
  stickerRank: number;
  trueRank: number;
  confidence: "high" | "medium" | "low";
  decision: string;
  reasons: string[];
  deliveryDays: number | null;
  warnings: string[];
  lines: LineView[];
  sameProduct: { match: string; markets: string[]; count: number } | null;
  vsSticker: { total: MoneyView; drivers: { kind: string; delta: MoneyView }[] } | null;
}

interface Search {
  id: string;
  query: string;
  quantity: number;
  via: "agent" | "search";
  createdAt: string;
  fxSource: string;
  rates: { pair: string; rate: string; asOf: string }[];
  markets: { country: string; source: string; offerCount: number; note?: string }[];
  rows: Row[];
}

const signed = (m: MoneyView) => (m.minor > 0 ? `+${m.text}` : m.text);

function BuyResult({
  r,
}: {
  r: { status: string; reasons: string[]; landed: string; charged: string; orderId?: string };
}) {
  const text: Record<string, string> = {
    CAPTURED: `Paid in the PayPal sandbox. Charged ${r.charged}; landed estimate ${r.landed}.`,
    AWAITING_APPROVAL: "Over your auto-buy limit, so it is waiting in Approvals. Nothing has been charged.",
    DENIED: "Your mandate does not allow this purchase. Nothing was charged.",
    FAILED: "PayPal declined the payment. The reserved amount was released.",
    UNKNOWN: "PayPal has not confirmed yet. The amount stays reserved; you will not be charged twice.",
  };
  return (
    <div role="status" aria-label="Purchase result" className="mt-3 border-t border-rule pt-3 text-[13px]">
      <Stamp status={r.status} /> <span className="ml-2">{text[r.status] ?? r.status}</span>
      {r.status === "DENIED" && (
        <div className="mt-1 text-stop">
          {r.reasons
            .filter((x) => x !== "ABOVE_APPROVAL_THRESHOLD")
            .map(reason)
            .join(" · ")}
        </div>
      )}
      {r.orderId && <div className="code mt-1 text-[12px] text-muted">PayPal order {r.orderId}</div>}
    </div>
  );
}

function Detail({ row, search }: { row: Row; search: Search }) {
  const [qty, setQty] = useState(search.quantity);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Parameters<typeof BuyResult>[0]["r"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const best = search.rows[0];
  return (
    <section aria-label="Offer detail" className="sheet p-4">
      <div className="label">
        Rank #{row.trueRank} by landed cost · #{row.stickerRank} by sticker price
      </div>
      <h3 className="mt-1 text-[17px] font-semibold leading-snug">{row.title}</h3>
      <div className="mt-0.5 text-[13px] text-ink-2">
        {row.store} · {row.merchantCountry ?? "country unknown"}
        {row.countrySource === "locale" && <span className="text-muted"> (from the search market)</span>}
        {row.deliveryDays != null && <> · about {row.deliveryDays} days</>}
      </div>

      <table className="ruled mt-4">
        <thead>
          <tr>
            <th>Line</th>
            <th>Basis</th>
            <th className="r">GBP</th>
          </tr>
        </thead>
        <tbody>
          {row.lines.map((l) => (
            <tr key={l.kind}>
              <td className="whitespace-nowrap">{LINE_TEXT[l.kind] ?? l.kind}</td>
              <td className="text-[12px] text-muted">{l.basis}</td>
              <td className={`r num ${l.estimate ? "est" : ""}`}>{l.amount.text.replace(" GBP", "")}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Landed total (estimate)</td>
            <td className="r num">{row.landed.text.replace(" GBP", "")}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-1 text-[11.5px] text-muted">
        Dotted figures are estimates. PayPal would charge {row.charged.text}.
      </p>

      {row.vsSticker && (
        <div className="mt-4">
          <div className="label mb-1">Against the cheapest sticker price</div>
          <div className="text-[13px]">
            <span className="num">{signed(row.vsSticker.total)}</span> overall:{" "}
            {row.vsSticker.drivers.slice(0, 4).map((d, i) => (
              <span key={d.kind}>
                {i > 0 && ", "}
                {LINE_TEXT[d.kind]?.toLowerCase() ?? d.kind} <span className="num">{signed(d.delta)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Stamp status={row.decision} />
        <span className="text-[13px] text-ink-2">
          {row.reasons.length ? row.reasons.map(reason).join(" · ") : "Within your mandate"}
        </span>
      </div>

      <div className="mt-4 flex items-end gap-2 border-t border-rule pt-4">
        <label className="w-20">
          <span className="label">Units</span>
          <input
            type="number"
            className="field mt-1"
            min={1}
            max={100}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
          />
        </label>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setResult(await post("/api/offers/buy", { searchId: search.id, offerId: row.offerId, quantity: qty }));
              refreshAll();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Checking…" : "Buy within mandate"}
        </button>
      </div>
      <p className="mt-2 text-[11.5px] text-muted">
        The mandate decides: pay now, send to Approvals, or refuse. Amounts are recalculated on the server for the units
        you choose.
      </p>
      {error && <p className="mt-2 text-stop">{error}</p>}
      {result && <BuyResult r={result} />}
      {row.offerId === best.offerId ? null : (
        <p className="mt-3 text-[12px] text-muted">Best landed cost in this search: {best.landed.text}.</p>
      )}
    </section>
  );
}

function DecisionCell(p: ICellRendererParams<Row>) {
  return p.data ? <Stamp status={p.data.decision} /> : null;
}
function WaterfallCell(p: ICellRendererParams<Row>) {
  return p.data ? (
    <div className="pt-[13px]">
      <Waterfall lines={p.data.lines} />
    </div>
  ) : null;
}

export function Offers() {
  const { data: search, error, loading } = useApi<Search | null>("/api/offers");
  const [override, setOverride] = useState<Search | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [by, setBy] = useState<"landed" | "sticker">("landed");
  const [q, setQ] = useState("insulated water bottle 1 litre");
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const s = override ?? search;

  const compact = selected !== null;
  const rows = useMemo(
    () =>
      s ? [...s.rows].sort((a, b) => (by === "landed" ? a.trueRank - b.trueRank : a.stickerRank - b.stickerRank)) : [],
    [s, by],
  );
  const cols = useMemo<ColDef<Row>[]>(() => {
    const first = by === "landed" ? "trueRank" : "stickerRank";
    const second = by === "landed" ? "stickerRank" : "trueRank";
    return [
      {
        headerName: by === "landed" ? "True #" : "Sticker #",
        field: first,
        minWidth: 72,
        maxWidth: 84,
        cellClass: "cell-num",
      },
      {
        headerName: by === "landed" ? "Sticker #" : "True #",
        field: second,
        minWidth: 80,
        maxWidth: 92,
        cellClass: "cell-num",
      },
      { headerName: "Product", field: "title", minWidth: 150, flex: 3 },
      { headerName: "Store", field: "store", minWidth: 92, flex: 1 },
      {
        headerName: "From",
        valueGetter: (p) => `${p.data?.merchantCountry ?? "?"}${p.data?.countrySource === "locale" ? "*" : ""}`,
        minWidth: 64,
        maxWidth: 72,
        cellClass: "cell-num",
      },
      {
        headerName: "Price",
        valueGetter: (p) => p.data?.price.text,
        minWidth: 96,
        flex: 1,
        cellClass: "cell-num",
        type: "rightAligned",
      },
      {
        headerName: "Landed (est.)",
        valueGetter: (p) => p.data?.landed.text,
        minWidth: 108,
        flex: 1,
        cellClass: "cell-num",
        type: "rightAligned",
        enableCellChangeFlash: true,
      },
      {
        headerName: "Cost build-up",
        cellRenderer: WaterfallCell,
        minWidth: 110,
        flex: 2,
        sortable: false,
        hide: compact,
      },
      { headerName: "Mandate", cellRenderer: DecisionCell, minWidth: 128, maxWidth: 150 },
    ];
  }, [by, compact]);
  const selectedRow = s?.rows.find((r) => r.offerId === selected) ?? null;

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSearchError(null);
    try {
      const r = await post<Search>("/api/offers", { query: q, quantity: qty });
      setOverride(r);
      setSelected(null);
    } catch (err) {
      setSearchError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <BoxHead
        no="01"
        title="Offers by landed cost"
        aside={
          s && (
            <span className="label">
              {s.rows.length} offers · {s.via === "agent" ? "from the agent" : "direct search"}
            </span>
          )
        }
      />
      <form onSubmit={runSearch} className="mb-5 flex flex-wrap items-end gap-2">
        <label className="min-w-[260px] flex-1">
          <span className="label">Search UK, US and German shops</span>
          <input
            className="field mt-1 font-sans text-[14px]"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={120}
          />
        </label>
        <label className="w-20">
          <span className="label">Units</span>
          <input
            type="number"
            className="field mt-1"
            min={1}
            max={100}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
          />
        </label>
        <button className="btn btn-primary" disabled={busy || q.trim().length < 2}>
          {busy ? "Ranking…" : "Rank offers"}
        </button>
        <span className="ml-auto flex gap-0 text-[13px]">
          <button
            type="button"
            className={`btn ${by === "landed" ? "btn-primary" : ""}`}
            onClick={() => setBy("landed")}
          >
            Landed cost
          </button>
          <button
            type="button"
            className={`btn -ml-px ${by === "sticker" ? "btn-primary" : ""}`}
            onClick={() => setBy("sticker")}
          >
            Sticker price
          </button>
        </span>
      </form>
      {searchError && <p className="mb-3 text-stop">{searchError}</p>}
      {error && <p className="text-stop">{error}</p>}
      {!loading && !s && <p className="text-muted">No search yet. Rank offers above, or ask on the Shop page.</p>}

      {s && (
        <>
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-ink-2">
            <span>
              “{s.query}” × {s.quantity}
            </span>
            {s.markets.map((m) => (
              <span key={m.country} className="num">
                {m.country}:{" "}
                {m.source === "failed"
                  ? "unavailable"
                  : `${m.offerCount} offers${m.source === "recorded" ? " (recorded)" : ""}`}
              </span>
            ))}
            <span className="num text-muted">
              FX {s.fxSource}: {s.rates.map((r) => `${r.pair} ${r.rate}`).join(", ")} ({s.rates[0]?.asOf})
            </span>
          </div>
          <div className={`grid gap-6 ${selectedRow ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
            <div>
              <GridProvider>
                <div style={{ height: 560 }}>
                  <AgGridReact<Row>
                    theme={gridTheme}
                    rowData={rows}
                    columnDefs={cols}
                    getRowId={(p) => p.data.offerId}
                    rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
                    onRowClicked={(e) => e.data && setSelected(e.data.offerId)}
                    suppressCellFocus
                  />
                </div>
              </GridProvider>
              <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1">
                {!selectedRow && <span className="text-[12px] text-ink-2">Select a row for the cost breakdown.</span>}
                <WaterfallKey />
                <span className="text-[12px] text-muted">* seller country inferred from the search market</span>
              </div>
            </div>
            <div>
              {selectedRow ? (
                <Detail key={selectedRow.offerId} row={selectedRow} search={s} />
              ) : (
                <p className="text-[13px] text-muted">Select an offer to see how its landed cost is built up.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
