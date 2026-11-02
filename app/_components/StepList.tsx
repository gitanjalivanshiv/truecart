"use client";

import { RefText, Stamp } from "./bits";
import { time, type Step } from "./useAgentChat";

export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="divide-y divide-rule">
      {steps.map((s, i) => (
        <li key={i} className="flex items-baseline gap-3 py-2 text-[13.5px]">
          <span className="num text-[12px] text-muted">{time(s.at)}</span>
          <span className={s.tone === "stop" ? "text-stop" : s.tone === "muted" ? "text-muted" : ""}>
            <RefText text={s.text} />
          </span>
          {s.status && (
            <span className="ml-auto">
              <Stamp status={s.status} />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
