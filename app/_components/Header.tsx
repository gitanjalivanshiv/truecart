"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import type { StateView } from "./types";
import { useApi } from "./useApi";

const NAV = [
  { href: "/", label: "Shop" },
  { href: "/offers", label: "Offers" },
  { href: "/approvals", label: "Approvals" },
  { href: "/ledger", label: "Ledger" },
  { href: "/mandate", label: "Mandate" },
  { href: "/red-team", label: "Red team" },
];

function subscribeTheme(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    () =>
      document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    () => null,
  );
  if (!theme) return null;
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      className="btn-link text-[12px] text-muted"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("tc-theme", next);
        } catch {
          /* private mode: the choice just won't persist */
        }
      }}
    >
      {next === "dark" ? "Dark" : "Light"}
    </button>
  );
}

/** The TrueCart mark: a T on a slip, with the total underlined in red ink (same drawing as app/icon.svg). */
function Mark() {
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" className="shrink-0">
      <rect x="1.5" y="1.5" width="29" height="29" fill="var(--sheet)" stroke="var(--ink)" strokeWidth="3" />
      <path d="M8 9.5h16M16 9.5v14" stroke="var(--ink)" strokeWidth="3.2" fill="none" />
      <path d="M19.5 23.5h5" stroke="var(--stop)" strokeWidth="3.2" />
    </svg>
  );
}

export function Header() {
  const path = usePathname();
  const { data } = useApi<StateView>("/api/state");
  const pct = data ? Math.min(100, (data.spend.committed.minor / Math.max(1, data.spend.monthlyCap.minor)) * 100) : 0;
  return (
    <header className="border-b-[1.5px] border-ink bg-sheet">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-10 gap-y-2 px-4 pt-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3 pb-3 leading-none">
          <Mark />
          <span>
            <span className="block text-[24px] font-extrabold tracking-[-0.03em]">TrueCart</span>
            <span className="label mt-1 hidden text-[10.5px] sm:block">
              the cheapest purchase, not the cheapest tag
            </span>
          </span>
        </Link>
        <nav className="-mb-px flex gap-x-1 self-end overflow-x-auto text-[15px] whitespace-nowrap max-sm:-mx-4 max-sm:w-[calc(100%+2rem)] max-sm:px-2">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`border-b-[3px] px-3 pt-1 pb-3 ${
                  active ? "border-accent font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"
                }`}
              >
                {n.label}
                {n.href === "/approvals" && data && data.awaitingApprovals > 0 && (
                  <span className="code ml-1.5 bg-wait px-1.5 py-0.5 text-[11.5px] font-semibold text-sheet">
                    {data.awaitingApprovals}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-5 pb-3">
          {data && (
            <div className="w-[170px]">
              <div className="flex items-baseline justify-between">
                <span className="label text-[10.5px]">This month</span>
                <span className="num text-[12px] text-muted">of {data.spend.monthlyCap.text.replace(" GBP", "")}</span>
              </div>
              <div className="num text-[17px] font-semibold" data-testid="month-spend">
                {data.spend.committed.text}
              </div>
              <div className="mt-1 h-[5px] bg-rule" aria-hidden="true">
                <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          {data?.mandate.paused && <span className="stamp stamp-stop">Paused</span>}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
