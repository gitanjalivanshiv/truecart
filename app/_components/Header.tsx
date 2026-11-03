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

export function Header() {
  const path = usePathname();
  const { data } = useApi<StateView>("/api/state");
  return (
    <header className="border-b border-ink">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-end gap-x-8 gap-y-3 px-4 pt-5 pb-3 sm:px-6">
        <Link href="/" className="leading-none">
          <span className="text-[22px] font-bold tracking-[-0.02em]">TrueCart</span>
          <span className="label ml-2 hidden align-[3px] sm:inline">landed-cost shopping under a mandate</span>
        </Link>
        <nav className="flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={
                  active ? "font-semibold underline decoration-2 underline-offset-[6px]" : "text-ink-2 hover:text-ink"
                }
              >
                {n.label}
                {n.href === "/approvals" && data && data.awaitingApprovals > 0 && (
                  <span className="code ml-1 text-[12px] text-wait">({data.awaitingApprovals})</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-end gap-5 text-right">
          {data && (
            <div className="text-[12px] leading-tight">
              <div className="label">This month</div>
              <div className="num">
                {data.spend.committed.text} <span className="text-muted">of {data.spend.monthlyCap.text}</span>
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
