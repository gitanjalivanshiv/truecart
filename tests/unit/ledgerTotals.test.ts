import { describe, expect, it } from "vitest";
import { ledgerTotals, type ledgerView } from "@/src/server/views";

type LedgerRow = ReturnType<typeof ledgerView>[number];
const mv = (minor: number, currency: string) => ({ minor, currency, text: `${(minor / 100).toFixed(2)} ${currency}` });

function row(over: Partial<LedgerRow> & { charged: LedgerRow["charged"] }): LedgerRow {
  return {
    purchaseId: "p",
    createdAt: "2026-11-04T00:00:00Z",
    status: "CAPTURED",
    title: "Item",
    merchant: "Store",
    quantity: 1,
    authorizedVia: "AUTO",
    landedEstimate: mv(0, "GBP"),
    paypalOrderId: "X",
    captureStatus: "COMPLETED",
    errorCode: null,
    actual: { gross: null, paypalFee: null, net: null, receivable: null, exchangeRate: null },
    predictedMerchantFee: null,
    feeModelErrorPct: null,
    ...over,
  };
}

describe("ledgerTotals", () => {
  it("sums paid purchases per charge currency and skips unpaid ones", () => {
    const totals = ledgerTotals([
      row({
        charged: mv(1_899, "GBP"),
        actual: { gross: null, paypalFee: mv(134, "GBP"), net: null, receivable: null, exchangeRate: null },
        predictedMerchantFee: mv(134, "GBP"),
      }),
      row({
        charged: mv(2_500, "GBP"),
        actual: { gross: null, paypalFee: mv(166, "GBP"), net: null, receivable: null, exchangeRate: null },
        predictedMerchantFee: mv(170, "GBP"),
      }),
      row({ charged: mv(2_893, "EUR") }),
      row({ charged: mv(9_999, "GBP"), status: "FAILED" }),
    ]);
    expect(totals).toEqual([
      {
        currency: "GBP",
        count: 2,
        charged: mv(4_399, "GBP"),
        paypalFee: mv(300, "GBP"),
        predictedMerchantFee: mv(304, "GBP"),
        feeModelErrorPct: 1.3,
      },
      {
        currency: "EUR",
        count: 1,
        charged: mv(2_893, "EUR"),
        paypalFee: null,
        predictedMerchantFee: null,
        feeModelErrorPct: null,
      },
    ]);
  });

  it("is empty when nothing has been paid", () => {
    expect(ledgerTotals([row({ charged: mv(100, "GBP"), status: "DENIED" as LedgerRow["status"] })])).toEqual([]);
  });
});
