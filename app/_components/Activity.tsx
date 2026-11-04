"use client";

import { BoxHead, Stamp } from "./bits";
import { useApi } from "./useApi";

interface Item {
  at: string;
  kind: "order" | "webhook";
  label: string;
  detail: string;
  status: string;
  response: unknown;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function PayPalActivity({ no = "03" }: { no?: string }) {
  const { data, error } = useApi<Item[]>("/api/activity");
  return (
    <section className="card p-6">
      <BoxHead no={no} title="PayPal activity" aside={<span className="label">sandbox</span>} />
      {error && <p className="text-stop">{error}</p>}
      {data && data.length === 0 && (
        <p className="text-[14px] text-muted">
          No PayPal calls yet. Orders and webhook events for your purchases appear here.
        </p>
      )}
      <ul className="divide-y divide-rule">
        {data?.map((a, i) => (
          <li key={i} className="py-3">
            <div className="flex items-baseline gap-3">
              <span className="num text-[12px] text-muted">{time(a.at)}</span>
              <span className="code text-[13.5px] font-medium">{a.label}</span>
              <span className="ml-auto">
                {a.kind === "webhook" ? (
                  <span className="stamp stamp-plain">Webhook</span>
                ) : (
                  <Stamp status={a.status} />
                )}
              </span>
            </div>
            <div className="mt-0.5 pl-[74px] text-[13.5px] text-ink-2">{a.detail}</div>
            {a.response != null && (
              <details className="mt-1 pl-[74px]">
                <summary className="cursor-pointer text-[12px] text-muted">Response (redacted)</summary>
                <pre className="code mt-1 max-h-64 overflow-auto bg-sheet p-2 text-[11.5px] leading-snug">
                  {JSON.stringify(a.response, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
