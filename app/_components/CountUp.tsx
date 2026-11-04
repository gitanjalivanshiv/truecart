"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates the number inside a server-formatted string ("18.99 GBP") from zero. Display only: it settles on
 * exactly the text it was given, and does nothing when motion is reduced.
 */
export function CountUp({ text, ms = 900 }: { text: string; ms?: number }) {
  const [shown, setShown] = useState(text);
  const first = useRef(true);
  useEffect(() => {
    const m = text.match(/^(.*?)(\d[\d,]*)(\.(\d+))?(.*)$/s);
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!m || reduce || !first.current) {
      setShown(text);
      return;
    }
    first.current = false;
    const [, pre, int, , dec = "", post] = m;
    const target = Number(int.replace(/,/g, "") + (dec ? `.${dec}` : ""));
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(p >= 1 ? text : `${pre}${(target * eased).toFixed(dec.length)}${post}`);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, ms]);
  return <span className="num">{shown}</span>;
}
