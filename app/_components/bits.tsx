"use client";

import { Fragment, type ReactNode } from "react";
import { LINE_TEXT, STATUS_TEXT, tone } from "./text";

export function Stamp({ status, big }: { status: string; big?: boolean }) {
  return (
    <span className={`stamp stamp-${tone(status)}${big ? " stamp-big" : ""}`}>{STATUS_TEXT[status] ?? status}</span>
  );
}

export function BoxHead({ no, title, aside }: { no: string; title: string; aside?: ReactNode }) {
  return (
    <div className="box-head">
      <span className="no">{no}</span>
      <h2>{title}</h2>
      {aside && <span className="aside">{aside}</span>}
    </div>
  );
}

export function Meter({ value, max, caption }: { value: number; max: number; caption?: ReactNode }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div
        className={`meter${pct >= 100 ? " over" : pct >= 80 ? " warn" : ""}`}
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      {caption && <div className="mt-1 text-[12px] text-muted">{caption}</div>}
    </div>
  );
}

export interface LineView {
  kind: string;
  amount: { minor: number; text: string };
  estimate: boolean;
  basis: string;
}

/** Proportional run of the positive cost lines. The removed origin VAT is shown in the table, not the bar. */
export function Waterfall({ lines }: { lines: LineView[] }) {
  const parts = lines.filter((l) => l.amount.minor > 0);
  const total = parts.reduce((s, l) => s + l.amount.minor, 0) || 1;
  return (
    <div className="wf" title={parts.map((l) => `${LINE_TEXT[l.kind] ?? l.kind}: ${l.amount.text}`).join("\n")}>
      {parts.map((l) => (
        <i key={l.kind} className={l.kind} style={{ width: `${(l.amount.minor / total) * 100}%` }} />
      ))}
    </div>
  );
}

export function WaterfallKey() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {(["item", "shipping", "importVat", "fxConversion"] as const).map((k) => (
        <span key={k}>
          <span className={`swatch wf-swatch-${k}`} />
          {LINE_TEXT[k]}
        </span>
      ))}
    </div>
  );
}

/** Agent text: **bold**, *italic*, `code`, line breaks and offer refs (o4) only. No HTML is ever injected. */
export function AgentText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\bo\d{1,3}\b)/g).map((part, j) =>
            part.startsWith("**") && part.endsWith("**") ? (
              <strong key={j}>{part.slice(2, -2)}</strong>
            ) : part.length > 2 && part.startsWith("*") && part.endsWith("*") ? (
              <em key={j}>{part.slice(1, -1)}</em>
            ) : part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
              <span key={j} className="code text-[12.5px]">
                {part.slice(1, -1)}
              </span>
            ) : /^o\d{1,3}$/.test(part) ? (
              <span key={j} className="code text-[12.5px]">
                {part}
              </span>
            ) : (
              <Fragment key={j}>{part.replace(/^\s*[-*]\s+/, "– ")}</Fragment>
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}

/** Plain text with offer refs (o4) set in mono so they read unambiguously. */
export function RefText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\bo\d{1,3}\b)/g).map((part, i) =>
        /^o\d{1,3}$/.test(part) ? (
          <span key={i} className="code text-[12.5px]">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
