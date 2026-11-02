"use client";

import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { BoxHead, Meter, Stamp } from "./bits";
import { gridTheme, GridProvider } from "./grid";
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
}

const StatusCell = (p: ICellRendererParams<LedgerRow>) => (p.data ? <Stamp status={p.data.status} /> : null);
const ViaCell = (p: ICellRendererParams<LedgerRow>) =>
  p.data ? <span className="label">{p.data.authorizedVia === "AUTO" ? "auto" : "approved"}</span> : null;

const cols: ColDef<LedgerRow>[] = [
  {
    headerName: "When",
    valueGetter: (p) =>
      p.data &&
      new Date(p.data.createdAt).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    minWidth: 120,
    maxWidth: 130,
    cellClass: "cell-num",
  },
  { headerName: "Item", valueGetter: (p) => p.data && `${p.data.title} × ${p.data.quantity}`, minWidth: 170, flex: 2 },
  { headerName: "Store", field: "merchant", minWidth: 90, flex: 1 },
  { headerName: "How", cellRenderer: ViaCell, minWidth: 90, maxWidth: 100 },
  { headerName: "Status", cellRenderer: StatusCell, minWidth: 110, maxWidth: 120 },
  {
    headerName: "Charged",
    valueGetter: (p) => p.data?.charged.text,
    minWidth: 104,
    flex: 1,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "Landed (est.)",
    valueGetter: (p) => p.data?.landedEstimate.text,
    minWidth: 110,
    flex: 1,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "PayPal fee",
    headerTooltip: "Paid by the merchant, from PayPal's capture breakdown",
    valueGetter: (p) => p.data?.actual.paypalFee?.text ?? "–",
    minWidth: 96,
    flex: 1,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "Our fee model",
    valueGetter: (p) => p.data?.predictedMerchantFee?.text ?? "–",
    minWidth: 110,
    flex: 1,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "Model error",
    valueGetter: (p) =>
      p.data?.feeModelErrorPct == null ? "–" : `${p.data.feeModelErrorPct > 0 ? "+" : ""}${p.data.feeModelErrorPct}%`,
    minWidth: 96,
    maxWidth: 110,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "Merchant got",
    valueGetter: (p) => p.data?.actual.receivable?.text ?? p.data?.actual.net?.text ?? "–",
    minWidth: 110,
    flex: 1,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "PayPal FX",
    valueGetter: (p) => (p.data?.actual.exchangeRate ? Number(p.data.actual.exchangeRate).toFixed(4) : "–"),
    minWidth: 86,
    maxWidth: 96,
    cellClass: "cell-num",
    type: "rightAligned",
  },
  {
    headerName: "PayPal order",
    valueGetter: (p) => p.data?.paypalOrderId ?? p.data?.errorCode ?? "",
    minWidth: 150,
    flex: 1,
    cellClass: "cell-num",
  },
];

export function Ledger() {
  const { data } = useApi<{ spend: StateView["spend"]; rows: LedgerRow[] }>("/api/ledger");
  const { data: state } = useApi<StateView>("/api/state");
  return (
    <div className="space-y-12">
      <section>
        <BoxHead no="01" title="Spend against your mandate" />
        {data && state && (
          <div className="grid gap-x-12 gap-y-6 md:grid-cols-3">
            <div>
              <div className="label mb-1">This month</div>
              <div className="num mb-2 text-[22px] leading-none">
                {data.spend.committed.text.replace(" GBP", "")}{" "}
                <span className="text-[13px] text-muted">of {data.spend.monthlyCap.text}</span>
              </div>
              <Meter
                value={data.spend.committed.minor}
                max={data.spend.monthlyCap.minor}
                caption={<>Left: {data.spend.remaining.text}. Pending payments count until settled.</>}
              />
            </div>
            <div>
              <div className="label mb-1">Per purchase</div>
              <div className="num text-[22px] leading-none">
                {state.mandate.perPurchaseCap.text.replace(" GBP", "")}
              </div>
              <p className="mt-2 text-[12.5px] text-muted">Anything above is refused, even with your approval.</p>
            </div>
            <div>
              <div className="label mb-1">Auto-buy up to</div>
              <div className="num text-[22px] leading-none">
                {state.mandate.approvalThreshold.text.replace(" GBP", "")}
              </div>
              <p className="mt-2 text-[12.5px] text-muted">
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
          aside={<span className="label">{data?.rows.length ?? 0} purchases</span>}
        />
        <p className="mb-3 max-w-[85ch] text-[13px] text-ink-2">
          Landed figures are our estimates at the time of purchase. The fee columns compare our merchant-fee model with
          the fee PayPal actually took from the merchant (from the capture breakdown); fees are paid by the merchant,
          not you. PayPal does not report the buyer&apos;s own conversion cost.
        </p>
        {data && data.rows.length === 0 ? (
          <p className="text-muted">No purchases yet.</p>
        ) : (
          <GridProvider>
            <div style={{ height: 420 }}>
              <AgGridReact<LedgerRow>
                theme={gridTheme}
                rowData={data?.rows ?? []}
                columnDefs={cols}
                getRowId={(p) => p.data.purchaseId}
                suppressCellFocus
              />
            </div>
          </GridProvider>
        )}
      </section>
    </div>
  );
}
