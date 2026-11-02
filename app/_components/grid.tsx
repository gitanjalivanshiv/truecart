"use client";

import { AllCommunityModule, themeQuartz } from "ag-grid-community";
import { AgGridProvider } from "ag-grid-react";
import type { ReactNode } from "react";

// AG Grid themed to the paper/ink system: hairline rules, mono figures, no rounded wrapper, no shadow.
export const gridTheme = themeQuartz.withParams({
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  dataFontSize: 13,
  headerFontSize: 10.5,
  headerFontWeight: 500,
  backgroundColor: "var(--sheet)",
  foregroundColor: "var(--ink)",
  chromeBackgroundColor: "var(--paper)",
  headerTextColor: "var(--muted)",
  borderColor: "var(--rule)",
  rowBorder: { color: "var(--rule)" },
  headerRowBorder: { color: "var(--ink)", width: 1 },
  columnBorder: false,
  headerColumnBorder: false,
  wrapperBorder: { color: "var(--ink)" },
  wrapperBorderRadius: 0,
  borderRadius: 0,
  accentColor: "var(--info)",
  selectedRowBackgroundColor: "var(--wait-bg)",
  oddRowBackgroundColor: "var(--sheet)",
  rowHeight: 40,
  headerHeight: 34,
  cellHorizontalPadding: 10,
  spacing: 6,
  browserColorScheme: "inherit",
});

const modules = [AllCommunityModule];

export function GridProvider({ children }: { children: ReactNode }) {
  return <AgGridProvider modules={modules}>{children}</AgGridProvider>;
}
