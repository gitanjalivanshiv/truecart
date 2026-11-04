import { describe, expect, it } from "vitest";
import { csvSafe } from "@/app/_components/csv";

describe("csvSafe", () => {
  it("neutralises formula-like cells from untrusted listings", () => {
    for (const evil of ['=HYPERLINK("http://x")', "+1+1", "@SUM(A1)", "-cmd|' /C calc'!A0", "\t=1", "\r=1"])
      expect(csvSafe(evil).startsWith("'")).toBe(true);
  });
  it("leaves ordinary values alone, including negative amounts", () => {
    expect(csvSafe("Steel bottle 1L")).toBe("Steel bottle 1L");
    expect(csvSafe("-1.20 GBP")).toBe("-1.20 GBP");
    expect(csvSafe("-0.5%")).toBe("-0.5%");
    expect(csvSafe(null)).toBe("");
    expect(csvSafe(3)).toBe("3");
  });
});
