"use client";

import { useState } from "react";
import { BoxHead } from "./bits";
import { post, refreshAll, useApi } from "./useApi";

type Stage = "LABEL_CREATED" | "IN_TRANSIT" | "AT_CUSTOMS" | "OUT_FOR_DELIVERY" | "DELIVERED";
interface Shipment {
  id: string;
  title: string;
  store: string;
  carrier: string;
  trackingNumber: string;
  paypalTrackerId: string | null;
  paypalError: string | null;
  paypalOrderId: string | null;
  shippedAt: string;
  delayed: boolean;
  state: {
    stage: Stage;
    dayOf: number;
    expectedDays: number;
    overdue: boolean;
    daysLate: number;
    timeline: { stage: Stage; day: number; reached: boolean }[];
  };
}

const STAGE_TEXT: Record<Stage, string> = {
  LABEL_CREATED: "Label created",
  IN_TRANSIT: "In transit",
  AT_CUSTOMS: "At UK customs",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
};

function evidence(s: Shipment): string {
  return [
    "Item not received: evidence summary (PayPal sandbox)",
    `Item: ${s.title} from ${s.store}`,
    `PayPal order: ${s.paypalOrderId ?? "unknown"}`,
    `Tracking: ${s.carrier} ${s.trackingNumber}${s.paypalTrackerId ? ` (PayPal tracker ${s.paypalTrackerId})` : ""}`,
    `Shipped: ${new Date(s.shippedAt).toDateString()}; expected within ${s.state.expectedDays} days`,
    `Status after ${s.state.dayOf} days: ${STAGE_TEXT[s.state.stage]} (${s.state.daysLate} days late)`,
    "Carrier events are simulated in this demo.",
  ].join("\n");
}

function Row({ s }: { s: Shipment }) {
  const [busy, setBusy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const act = async (action: "advance" | "delay" | "reset") => {
    setBusy(true);
    try {
      await post(`/api/shipments/${s.id}`, { action });
      refreshAll();
    } finally {
      setBusy(false);
    }
  };
  const delivered = s.state.stage === "DELIVERED";
  return (
    <article className="sheet p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="text-[15px] font-semibold">{s.title}</h3>
        <span className="text-[13px] text-ink-2">{s.store}</span>
        <span className="ml-auto">
          {s.state.overdue ? (
            <span className="stamp stamp-stop">Overdue</span>
          ) : delivered ? (
            <span className="stamp stamp-go">Delivered</span>
          ) : (
            <span className="stamp stamp-wait">{STAGE_TEXT[s.state.stage]}</span>
          )}
        </span>
      </div>
      <div className="mt-1 text-[12.5px] text-muted">
        {s.carrier} · <span className="code">{s.trackingNumber}</span> ·{" "}
        {s.paypalTrackerId ? (
          <>
            PayPal tracker <span className="code">{s.paypalTrackerId}</span>
          </>
        ) : (
          <span className="text-stop">PayPal tracker not registered{s.paypalError ? ` (${s.paypalError})` : ""}</span>
        )}
      </div>

      <ol className="mt-4 grid grid-flow-col gap-1" aria-label="Delivery progress (simulated)">
        {s.state.timeline.map((t) => (
          <li key={t.stage} className="min-w-0">
            <div className={`h-1.5 ${t.reached ? (s.state.overdue ? "bg-stop" : "bg-ink") : "bg-rule"}`} />
            <div className={`mt-1 truncate text-[11.5px] ${t.reached ? "text-ink" : "text-muted"}`}>
              {STAGE_TEXT[t.stage]}
            </div>
            <div className="label">day {t.day}</div>
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="num text-muted">
          Day {s.state.dayOf} of {s.state.expectedDays} expected
        </span>
        <span className="text-muted">· simulated carrier events</span>
        <span className="ml-auto flex gap-2">
          <button className="btn" disabled={busy || s.state.dayOf >= 30} onClick={() => act("advance")}>
            +1 day
          </button>
          {!s.delayed && !delivered && (
            <button className="btn" disabled={busy} onClick={() => act("delay")}>
              Simulate a delay
            </button>
          )}
          <button className="btn-link text-muted" disabled={busy} onClick={() => act("reset")}>
            Reset
          </button>
        </span>
      </div>

      {s.state.overdue && (
        <div className="mt-3 border-t border-rule pt-3 text-[13px]">
          <p className="text-stop">
            {s.state.daysLate} days past the expected delivery. You may be able to open an &quot;item not received&quot;
            case with PayPal.
          </p>
          <div className="mt-2 flex gap-2">
            <button className="btn" onClick={() => setShowEvidence((v) => !v)}>
              {showEvidence ? "Hide evidence" : "Prepare evidence"}
            </button>
            <a className="btn" href="https://www.sandbox.paypal.com/resolutioncenter" target="_blank" rel="noreferrer">
              PayPal Resolution Center (sandbox)
            </a>
          </div>
          {showEvidence && <pre className="code mt-2 whitespace-pre-wrap bg-paper p-3 text-[12px]">{evidence(s)}</pre>}
        </div>
      )}
    </article>
  );
}

export function Deliveries() {
  const { data } = useApi<Shipment[]>("/api/shipments");
  return (
    <section>
      <BoxHead no="03" title="Deliveries" aside={<span className="label">PayPal tracking · simulated carrier</span>} />
      <p className="mb-4 max-w-[85ch] text-[13px] text-ink-2">
        After payment the (simulated) shop ships and registers the tracking number with PayPal on the order. Carrier
        progress is simulated: use +1 day to move time forward, or simulate a delay to see how an overdue parcel is
        handled.
      </p>
      {data && data.length === 0 && <p className="text-muted">No shipments yet.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {data?.map((s) => (
          <Row key={s.id} s={s} />
        ))}
      </div>
    </section>
  );
}
