"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Segmented control with a pill that slides to the chosen option. Buttons keep aria-pressed for tests and AT. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  const wrap = useRef<HTMLSpanElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);
  return (
    <span ref={wrap} className="seg" role="group" aria-label={label}>
      {pill && <span className="seg-pill" style={{ left: pill.left, width: pill.width }} aria-hidden="true" />}
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}
