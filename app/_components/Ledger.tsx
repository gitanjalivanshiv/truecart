"use client";

import type { ColDef, GridApi, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo, useRef, useState } from "react";
import { BoxHead, Meter, PageHead, Stamp } from "./bits";
import { Deliveries } from "./Deliveries";
import { exportCsv, gridTheme, GridProvider } from "./grid";
import { PayPalCheck } from "./PayPalCheck";
import type { MoneyView, StateView } from "./types";
import { useApi } from "./useApi";

interface LedgerRow {
  purchaseId: string;
  createdAt: string;
  status: string;
  title: string;
  merchant: string;
  quantity: number;
  authorizedVia: "AUTO" | "APPROVAL";
  charged: MoneyView;
  landedEstimate: MoneyView;
  paypalOrderId: string | null;
  errorCode: string | null;
  actual: {
    gross: MoneyView | null;
    paypalFee: MoneyView | null;
    net: MoneyView | null;
    receivable: MoneyView | null;
    exchangeRate: string | null;
  };
  predictedMerchantFee: MoneyView | null;
  feeModelErrorPct: number | null;
  /** Set on the pinned totals rows (one per charge currency, summed on the server). */
  total?: true;
}

interface Totals {
  currency: string;
  count: number;
  charged: MoneyView;
  paypalFee: MoneyView | null;
  predictedMerchantFee: MoneyView | null;
  feeModelErrorPct: number | null;
}

const totalRow = (t: Totals): LedgerRow => ({
  purchaseId: `total-${t.currency}`,
  createdAt: "",
  status: "",
  title: `${t.count} paid in ${t.currency}`,
  merchant: "",
  quantity: 0,
  authorizedVia: "AUTO",
  charged: t.charged,
  landedEstimate: { minor: 0, currency: t.currency, text: "" },
  paypalOrderId: null,
  errorCode: null,
  actual: { gross: null, paypalFee: t.paypalFee, net: null, receivable: null, exchangeRate: null },
  predictedMerchantFee: t.predictedMerchantFee,
  feeModelErrorPct: t.feeModelErrorPct,
  total: true,
});

const StatusCell = (p: ICellRendererParams<LedgerRow>) =>
  p.data && !p.data.total ? <Stamp status={p.data.status} /> : null;
const ViaCell = (p: ICellRendererParams<LedgerRow>) =>
  p.data && !p.data.total ? (
    <span className="label">{p.data.authorizedVia === "AUTO" ? "auto" : "approved"}</span>
  ) : null;

interface GridContext {
  onCheck: (row: LedgerRow) => void;
}
const CheckCell = (p: ICellRendererParams<LedgerRow, unknown, GridContext>) =>
  p.data?.paypalOrderId ? (
    <button className="btn-link text-[13px]" onClick={() => p.context.onCheck(p.data!)}>
      Check with PayPal
    </button>
  ) : null;

const cols: ColDef<LedgerRow>[] = [
  {
    headerName: "When",
    colId: "when",
    valueGetter: (p) => {
      if (!p.data) return null;
      if (p.data.total) return "Total";
      return new Date(p.data.createdAt).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
    minWidth: 120,
    maxWidth: 130,
    cellClass: "cell-num",
  },
  {
    headerName: "Item",
    colId: "item",
    valueGetter: (p) => p.data && (p.data.total ? p.data.title : `${p.data.title} × ${p.data.quantity}`),
    minWidth: 170,
    flex: 2,
  },
  { headerName: "Store", field: "merchant", minWidth: 90, flex: 1 },
  {
    headerName: "How",
    colId: "how",
    valueGetter: (p) => (p.data && !p.data.total ? p.data.authorizedVia.toLowerCase() : ""),
    cellRenderer: ViaCell,
    minWidth: 90,
    maxWidth: 100,
  },
  { headerName: "Status", field: "status", cellRenderer: StatusCell, minWidth: 110, maxWidth: 120 },
  {
    headerName: "Charged",
    colId: "charged",
    valueGetter: (p) => p.data?.charged.text,
    minWidth: 104,
    flex: 1,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "Landed (est.)",
    colId: "landed",
    valueGetter: (p) => (p.data?.total ? "" : p.data?.landedEstimate.text),
    minWidth: 110,
    flex: 1,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "PayPal fee",
    colId: "fee",
    headerTooltip: "Paid by the merchant, from PayPal's capture breakdown",
    valueGetter: (p) => p.data?.actual.paypalFee?.text ?? "–",
    minWidth: 96,
    flex: 1,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "Our fee model",
    colId: "model",
    valueGetter: (p) => p.data?.predictedMerchantFee?.text ?? "–",
    minWidth: 110,
    flex: 1,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "Model error",
    colId: "error",
    valueGetter: (p) =>
      p.data?.feeModelErrorPct == null ? "–" : `${p.data.feeModelErrorPct > 0 ? "+" : ""}${p.data.feeModelErrorPct}%`,
    minWidth: 96,
    maxWidth: 110,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "Merchant got",
    colId: "received",
    valueGetter: (p) => (p.data?.total ? "" : (p.data?.actual.receivable?.text ?? p.data?.actual.net?.text ?? "–")),
    minWidth: 110,
    flex: 1,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "PayPal FX",
    colId: "fx",
    valueGetter: (p) =>
      p.data?.total ? "" : p.data?.actual.exchangeRate ? Number(p.data.actual.exchangeRate).toFixed(4) : "–",
    minWidth: 86,
    maxWidth: 96,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "PayPal order",
    colId: "order",
    valueGetter: (p) => p.data?.paypalOrderId ?? p.data?.errorCode ?? "",
    minWidth: 150,
    flex: 1,
    cellClass: "cell-num",
  },
  {
    headerName: "PayPal record",
    colId: "check",
    cellRenderer: CheckCell,
    minWidth: 140,
    maxWidth: 150,
    pinned: "right",
  },
];
const EXPORT_COLUMNS = cols.map((c) => c.colId ?? c.field!).filter((id) => id !== "check");

export function Ledger() {
  const { data, loading } = useApi<{ spend: StateView["spend"]; rows: LedgerRow[]; totals: Totals[] }>("/api/ledger");
  const api = useRef<GridApi<LedgerRow> | null>(null);
  const pinned = useMemo(() => (data?.totals ?? []).map(totalRow), [data]);
  const { data: state } = useApi<StateView>("/api/state");
  const [checking, setChecking] = useState<LedgerRow | null>(null);
  return (
    <div className="space-y-12">
      <PageHead kicker="Ledger" title="Every payment, checked against PayPal.">
        What you spent against your caps, each purchase reconciled with PayPal&apos;s own record and fees, and where
        each parcel is.
      </PageHead>
      <section>
        <BoxHead no="01" title="Spend against your mandate" />
        {loading && <p className="label">Loading…</p>}
        {data && state && (
          <div className="grid gap-px border-[1.5px] border-ink bg-ink md:grid-cols-3">
            <div className="bg-sheet p-5">
              <div className="label mb-2">This month</div>
              <div className="figure mb-3 text-[34px]">
                {data.spend.committed.text.replace(" GBP", "")}{" "}
                <span className="text-[14px] font-normal text-muted">of {data.spend.monthlyCap.text}</span>
              </div>
              <Meter
                value={data.spend.committed.minor}
                max={data.spend.monthlyCap.minor}
                caption={<>Left: {data.spend.remaining.text}. Pending payments count until settled.</>}
              />
            </div>
            <div className="bg-sheet p-5">
              <div className="label mb-2">Per purchase</div>
              <div className="figure text-[34px]">{state.mandate.perPurchaseCap.text.replace(" GBP", "")}</div>
              <p className="mt-3 text-[14px] text-ink-2">Anything above is refused, even with your approval.</p>
            </div>
            <div className="bg-sheet p-5">
              <div className="label mb-2">Auto-buy up to</div>
              <div className="figure text-[34px]">{state.mandate.approvalThreshold.text.replace(" GBP", "")}</div>
              <p className="mt-3 text-[14px] text-ink-2">
                Above this, purchases wait in Approvals. Max {state.mandate.maxUnitsPerPurchase} units per purchase.
              </p>
            </div>
          </div>
        )}
      </section>

      <section>
        <BoxHead
          no="02"
          title="Purchases and reconciliation"
          aside={
            <span className="flex items-center gap-4">
              <span className="label">{data?.rows.length ?? 0} purchases</span>
              {!!data?.rows.length && (
                <button
                  className="btn-link text-[13px]"
                  onClick={() => exportCsv(api.current, "ledger", EXPORT_COLUMNS)}
                >
                  Download CSV
                </button>
              )}
            </span>
          }
        />
        <p className="mb-4 max-w-[85ch] text-[14.5px] text-ink-2">
          Landed figures are our estimates at the time of purchase. The fee columns compare our merchant-fee model with
          the fee PayPal actually took from the merchant (from the capture breakdown); fees are paid by the merchant,
          not you. PayPal does not report the buyer&apos;s own conversion cost.
        </p>
        {data && data.rows.length === 0 ? (
          <p className="text-muted">No purchases yet.</p>
        ) : (
          <GridProvider>
            <div className="grid-fit">
              <AgGridReact<LedgerRow>
                theme={gridTheme}
                rowData={data?.rows ?? []}
                columnDefs={cols}
                getRowId={(p) => p.data.purchaseId}
                pinnedBottomRowData={pinned}
                getRowClass={(p) => (p.data?.total ? "row-total" : undefined)}
                onGridReady={(e) => (api.current = e.api)}
                domLayout="autoHeight"
                suppressCellFocus
                context={{ onCheck: setChecking } satisfies GridContext}
              />
            </div>
          </GridProvider>
        )}
        {checking && (
          <PayPalCheck
            key={checking.purchaseId}
            purchaseId={checking.purchaseId}
            title={`${checking.title} × ${checking.quantity} · ${checking.charged.text}`}
            onClose={() => setChecking(null)}
          />
        )}
      </section>

      <Deliveries />
    </div>
  );
}
