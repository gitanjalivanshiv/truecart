"use client";

import type { ColDef, GridApi, ICellRendererParams, IRowNode } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Download, PackageSearch, Search as SearchIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHead, Stamp, Waterfall, WaterfallKey, type LineView } from "./bits";
import { CountUp } from "./CountUp";
import { exportCsv, gridTheme, GridProvider } from "./grid";
import { Segmented } from "./Segmented";
import { toast } from "./toast";
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
    <section aria-label="Offer detail" className="card fade-in p-5 xl:sticky xl:top-20">
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
              const r = await post<Parameters<typeof BuyResult>[0]["r"]>("/api/offers/buy", {
                searchId: search.id,
                offerId: row.offerId,
                quantity: qty,
              });
              setResult(r);
              if (r.status === "CAPTURED")
                toast("Paid in the PayPal sandbox", { body: `Charged ${r.charged}.`, tone: "success" });
              else if (r.status === "AWAITING_APPROVAL")
                toast("Sent to Approvals", { body: "Over your auto-buy limit. Nothing charged yet.", tone: "warning" });
              else if (r.status === "DENIED")
                toast("Refused by your mandate", { body: "No payment was made.", tone: "danger" });
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

const MARKET_NAME: Record<string, string> = { GB: "UK", US: "US", DE: "Germany" };

/** Three headline figures for the current search; all amounts come from the server as text. */
function Summary({ s }: { s: Search }) {
  const best = s.rows.find((r) => r.trueRank === 1);
  const tag = s.rows.find((r) => r.stickerRank === 1);
  if (!best || !tag) return null;
  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      <div className="card lift border-brand bg-brand-soft p-5" data-reveal>
        <div className="label text-brand-text">Best purchase</div>
        <div className="figure mt-2 text-[32px] text-brand-text">
          <CountUp text={best.landed.text} />
        </div>
        <div className="mt-1 text-[14px] text-ink-2">
          {best.title} · {best.store}
        </div>
      </div>
      <div className="card lift p-5" data-reveal style={{ "--d": "0.08s" } as React.CSSProperties}>
        <div className="label">Cheapest price tag</div>
        <div className="figure mt-2 text-[32px]">
          <CountUp text={tag.price.text} />
        </div>
        <div className="mt-1 text-[14px] text-ink-2">
          lands at {tag.landed.text} · <strong>#{tag.trueRank}</strong> by what you pay
        </div>
      </div>
      <div className="card lift p-5" data-reveal style={{ "--d": "0.16s" } as React.CSSProperties}>
        <div className="label">Searched</div>
        <div className="figure mt-2 text-[32px]">
          <CountUp text={`${s.rows.length} offers`} />
        </div>
        <div className="mt-1 text-[14px] text-ink-2">
          {s.markets.map((m) => MARKET_NAME[m.country] ?? m.country).join(", ")} ·{" "}
          {s.via === "agent" ? "found by the agent" : "direct search"}
        </div>
      </div>
    </div>
  );
}
const breakdown = (r: Row) =>
  r.lines.map((l) => `${LINE_TEXT[l.kind] ?? l.kind} ${l.amount.text}${l.estimate ? " (est.)" : ""}`).join(" · ");

export function Offers() {
  const { data: search, error, loading } = useApi<Search | null>("/api/offers");
  const [override, setOverride] = useState<Search | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [by, setBy] = useState<"landed" | "sticker">("landed");
  const [q, setQ] = useState("insulated water bottle 1 litre");
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [market, setMarket] = useState<string>("ALL");
  const [allowedOnly, setAllowedOnly] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [shown, setShown] = useState<number | null>(null);
  const api = useRef<GridApi<Row> | null>(null);
  const s = override ?? search;

  // Market and mandate filters run as an AG Grid external filter; the text box is the grid's quick filter.
  const isExternalFilterPresent = useCallback(() => market !== "ALL" || allowedOnly, [market, allowedOnly]);
  const doesExternalFilterPass = useCallback(
    (node: IRowNode<Row>) =>
      !!node.data &&
      (market === "ALL" || node.data.market === market) &&
      (!allowedOnly || node.data.decision !== "DENIED"),
    [market, allowedOnly],
  );
  useEffect(() => api.current?.onFilterChanged(), [market, allowedOnly]);

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
        minWidth: 84,
        maxWidth: 96,
        cellClass: "cell-num",
      },
      {
        headerName: by === "landed" ? "Sticker #" : "True #",
        field: second,
        minWidth: 100,
        maxWidth: 112,
        cellClass: "cell-num",
      },
      { headerName: "Product", field: "title", minWidth: 150, flex: 3 },
      { headerName: "Store", field: "store", minWidth: 112, flex: 1 },
      {
        headerName: "From",
        colId: "from",
        valueGetter: (p) => `${p.data?.merchantCountry ?? "?"}${p.data?.countrySource === "locale" ? "*" : ""}`,
        minWidth: 64,
        maxWidth: 72,
        cellClass: "cell-num",
      },
      {
        headerName: "Price",
        colId: "price",
        valueGetter: (p) => p.data?.price.text,
        minWidth: 116,
        flex: 1,
        cellClass: "cell-num",
        type: "rightAligned",
      },
      {
        headerName: "Landed (est.)",
        colId: "landed",
        valueGetter: (p) => p.data?.landed.text,
        tooltipValueGetter: (p) => (p.data ? breakdown(p.data) : null),
        minWidth: 124,
        flex: 1,
        cellClass: "cell-num",
        type: "rightAligned",
        enableCellChangeFlash: true,
      },
      {
        headerName: "Cost build-up",
        colId: "buildup",
        cellRenderer: WaterfallCell,
        minWidth: 110,
        flex: 2,
        sortable: false,
        hide: compact,
      },
      { headerName: "Mandate", field: "decision", cellRenderer: DecisionCell, minWidth: 128, maxWidth: 150 },
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
      <PageHead kicker="Offers · UK, US and German shops" title="Ranked by what you would actually pay">
        Every offer is priced the same way: item, shipping, UK import VAT and duty, and the cost of currency conversion.
        Switch to price tag order to see how different the list looks.
      </PageHead>
      <form onSubmit={runSearch} className="card mb-8 flex flex-wrap items-end gap-3 p-4">
        <label className="min-w-[260px] flex-1">
          <span className="label">Search UK, US and German shops</span>
          <input
            className="field mt-1 font-sans text-[15px]"
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
          <SearchIcon size={17} aria-hidden="true" />
          {busy ? "Ranking…" : "Rank offers"}
        </button>
        <span className="ml-auto">
          <span className="label mb-1 block">Order by</span>
          <Segmented
            label="Order by"
            value={by}
            onChange={setBy}
            options={[
              { value: "landed", label: "Landed cost" },
              { value: "sticker", label: "Sticker price" },
            ]}
          />
        </span>
      </form>
      {searchError && <p className="mb-3 text-stop">{searchError}</p>}
      {error && <p className="text-stop">{error}</p>}
      {loading && !s && <p className="label">Loading…</p>}
      {!loading && !s && (
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-brand-soft text-brand-text">
            <PackageSearch size={28} />
          </span>
          <p className="mt-4 text-[20px] font-bold">No search yet</p>
          <p className="mt-2 text-ink-2">
            Press <strong>Rank offers</strong> above for the example, or ask the agent on the{" "}
            <Link href="/" className="font-semibold underline underline-offset-2">
              Shop
            </Link>{" "}
            page.
          </p>
        </div>
      )}

      {s && (
        <>
          <Summary s={s} />
          <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-2">
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
          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-3" role="group" aria-label="Filter offers">
            <Segmented
              label="Market"
              value={market}
              onChange={setMarket}
              options={["ALL", ...s.markets.map((m) => m.country)].map((c) => ({
                value: c,
                label: c === "ALL" ? "All shops" : (MARKET_NAME[c] ?? c),
              }))}
            />
            <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-medium">
              <input
                type="checkbox"
                className="switch"
                checked={allowedOnly}
                onChange={(e) => setAllowedOnly(e.target.checked)}
              />
              Only what my mandate allows
            </label>
            <input
              className="field max-w-[240px] font-sans text-[14px]"
              placeholder="Filter by product or store"
              aria-label="Filter by product or store"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
            <span className="label ml-auto" role="status">
              {shown ?? s.rows.length} of {s.rows.length} shown
            </span>
            <button
              type="button"
              className="btn py-2"
              onClick={() =>
                exportCsv(api.current, "offers", [
                  by === "landed" ? "trueRank" : "stickerRank",
                  by === "landed" ? "stickerRank" : "trueRank",
                  "title",
                  "store",
                  "from",
                  "price",
                  "landed",
                  "decision",
                ])
              }
            >
              <Download size={16} aria-hidden="true" />
              Download CSV
            </button>
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
                    onGridReady={(e) => (api.current = e.api)}
                    onModelUpdated={(e) => setShown(e.api.getDisplayedRowCount())}
                    quickFilterText={filterText}
                    isExternalFilterPresent={isExternalFilterPresent}
                    doesExternalFilterPass={doesExternalFilterPass}
                    rowClassRules={{
                      "row-best": (p) => p.data?.trueRank === 1,
                      "row-denied": (p) => p.data?.decision === "DENIED",
                    }}
                    tooltipShowDelay={250}
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
