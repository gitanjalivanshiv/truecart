"use client";

import { Waterfall, WaterfallKey, type LineView } from "./bits";
import { CountUp } from "./CountUp";
import type { MoneyView } from "./types";
import { useApi } from "./useApi";

interface Pick {
  title: string;
  store: string;
  market: string;
  price: MoneyView;
  landed: MoneyView;
  stickerRank: number;
  trueRank: number;
  lines: LineView[];
}
interface ShowcaseData {
  query: string;
  offerCount: number;
  markets: string[];
  best: Pick;
  cheapestSticker: Pick;
  landedGap: MoneyView;
}

const COUNTRY: Record<string, string> = { GB: "UK", US: "US", DE: "Germany" };

function Offer({ p, kind }: { p: Pick; kind: "tag" | "best" }) {
  const best = kind === "best";
  return (
    <div className={best ? "m-2 rounded-[12px] bg-brand-soft p-4" : "px-6 py-5"}>
      <div className="flex items-center justify-between gap-3">
        {best ? (
          <span className="stamp bg-brand text-[var(--brand-ink)]">Best purchase</span>
        ) : (
          <span className="stamp stamp-plain">Cheapest price tag</span>
        )}
        <span className="label">
          {p.store} · {COUNTRY[p.market] ?? p.market}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 items-end gap-4">
        <div>
          <div className="label mb-1">Price tag</div>
          <div className={`figure text-[22px] ${best ? "" : "text-ink-2"}`}>{p.price.text}</div>
        </div>
        <div className="text-right">
          <div className="label mb-1">You pay (est.)</div>
          <div className={`figure text-[30px] ${best ? "text-brand-text" : ""}`}>
            <CountUp text={p.landed.text} />
          </div>
        </div>
      </div>
      <div className="mt-3">
        <Waterfall lines={p.lines} />
      </div>
      <div className="mt-2 text-[13px] text-ink-2">
        {best ? (
          <>
            #{p.trueRank} by what you pay · #{p.stickerRank} by price tag
          </>
        ) : (
          <>
            #{p.stickerRank} by price tag · <strong>#{p.trueRank} by what you pay</strong> once shipping, UK import VAT
            and conversion are added
          </>
        )}
      </div>
    </div>
  );
}

/** The opening example, from a recorded search ranked by the real engines (see /api/showcase). */
export function Showcase() {
  const { data } = useApi<ShowcaseData | null>("/api/showcase");
  if (!data) return <div className="skeleton h-[460px]" aria-hidden="true" />;
  return (
    <figure className="card" aria-label="Example: cheapest price tag against best purchase">
      <figcaption className="border-b border-border px-6 py-4">
        <div className="label">Example search · recorded</div>
        <div className="mt-0.5 text-[15px] font-semibold">
          “{data.query}” · {data.offerCount} offers from {data.markets.map((m) => COUNTRY[m] ?? m).join(", ")}
        </div>
      </figcaption>
      <Offer p={data.cheapestSticker} kind="tag" />

      <Offer p={data.best} kind="best" />
      <div className="border-t border-border px-6 py-4 text-[14.5px]">
        The cheapest tag would cost{" "}
        <strong className="mark num">
          <CountUp text={data.landedGap.text} />
        </strong>{" "}
        more, delivered.
        <div className="mt-2">
          <WaterfallKey />
        </div>
        <div className="mt-1 text-[12px] text-muted">
          Shipping, tax and FX are estimates. Stores are masked. Merchants are simulated.
        </div>
      </div>
    </figure>
  );
}
