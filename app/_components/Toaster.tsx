"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { TOAST_EVENT, type ToastMessage } from "./toast";

const ICON = { success: CircleCheck, warning: TriangleAlert, danger: CircleAlert, info: Info };
const TONE = {
  success: "text-brand-text",
  warning: "text-wait",
  danger: "text-stop",
  info: "text-info",
};

export function Toaster() {
  const [items, setItems] = useState<ToastMessage[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<ToastMessage>).detail;
      setItems((xs) => [...xs.slice(-3), t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 5000);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => window.removeEventListener(TOAST_EVENT, on);
  }, []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
    >
      {items.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div
            key={t.id}
            className="card pointer-events-auto flex items-start gap-3 p-4"
            style={{ animation: "toast-in 0.35s cubic-bezier(0.2,0.8,0.2,1) both" }}
          >
            <Icon size={20} className={`mt-0.5 shrink-0 ${TONE[t.tone]}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{t.title}</div>
              {t.body && <div className="mt-0.5 text-[14px] text-ink-2">{t.body}</div>}
            </div>
            <button
              className="icon-btn -mt-1 -mr-2 h-8 w-8"
              aria-label="Dismiss"
              onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
