"use client";

import { AllCommunityModule, themeQuartz, type GridApi, type ProcessCellForExportParams } from "ag-grid-community";
import { AgGridProvider } from "ag-grid-react";
import type { ReactNode } from "react";
import { csvSafe } from "./csv";

// AG Grid themed to the paper/ink system: hairline rules, mono figures, no rounded wrapper, no shadow.
export const gridTheme = themeQuartz.withParams({
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  dataFontSize: 14,
  headerFontSize: 13,
  headerFontWeight: 600,
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--text)",
  chromeBackgroundColor: "var(--surface-2)",
  headerBackgroundColor: "var(--surface-2)",
  headerTextColor: "var(--muted)",
  borderColor: "var(--border)",
  rowBorder: { color: "var(--border)" },
  headerRowBorder: { color: "var(--border)" },
  columnBorder: false,
  headerColumnBorder: false,
  wrapperBorder: { color: "var(--border)" },
  wrapperBorderRadius: 16,
  borderRadius: 10,
  accentColor: "var(--brand)",
  selectedRowBackgroundColor: "var(--brand-soft)",
  rowHoverColor: "var(--surface-2)",
  oddRowBackgroundColor: "var(--surface)",
  rowHeight: 50,
  headerHeight: 44,
  cellHorizontalPadding: 14,
  spacing: 6,
  browserColorScheme: "inherit",
});

const modules = [AllCommunityModule];

export function GridProvider({ children }: { children: ReactNode }) {
  return <AgGridProvider modules={modules}>{children}</AgGridProvider>;
}

/** Downloads what the grid currently shows (filters and sort applied), labelled as sandbox data. */
export function exportCsv<T>(api: GridApi<T> | null, name: string, columnKeys?: string[]) {
  if (!api) return;
  const stamp = new Date().toISOString().slice(0, 10);
  api.exportDataAsCsv({
    fileName: `truecart-${name}-${stamp}.csv`,
    columnKeys,
    prependContent:
      "TrueCart export (PayPal sandbox: no real money; merchants simulated; landed costs are estimates)\n",
    processCellCallback: (p: ProcessCellForExportParams<T>) => csvSafe(p.formatValue(p.value)),
  });
}
