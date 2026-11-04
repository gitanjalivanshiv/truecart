"use client";

import {
  Inbox,
  ListOrdered,
  Menu,
  Moon,
  ReceiptText,
  ShieldAlert,
  ShoppingBag,
  SlidersHorizontal,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { CountUp } from "./CountUp";
import { Toaster } from "./Toaster";
import type { StateView } from "./types";
import { useApi } from "./useApi";

const NAV: { href: string; label: string; icon: LucideIcon; hint: string }[] = [
  { href: "/", label: "Shop", icon: ShoppingBag, hint: "Ask the agent" },
  { href: "/offers", label: "Offers", icon: ListOrdered, hint: "Ranked by landed cost" },
  { href: "/approvals", label: "Approvals", icon: Inbox, hint: "Waiting for you" },
  { href: "/ledger", label: "Ledger", icon: ReceiptText, hint: "Payments and deliveries" },
  { href: "/mandate", label: "Mandate", icon: SlidersHorizontal, hint: "Your limits" },
  { href: "/red-team", label: "Red team", icon: ShieldAlert, hint: "Try to break it" },
];
const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path.startsWith(href));

/** The TrueCart mark: a T on a slip, the total underlined in red (same drawing as app/icon.svg). */
function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--brand)" />
      <path d="M9 10h14M16 10v13" stroke="var(--brand-ink)" strokeWidth="3.2" strokeLinecap="round" fill="none" />
      <path d="M19.5 23h4" stroke="var(--highlight)" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

function subscribeTheme(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => {
    obs.disconnect();
    mq.removeEventListener("change", onChange);
  };
}
const currentTheme = () =>
  document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => null);
  if (!theme) return <div className="h-9" />;
  const dark = theme === "dark";
  const set = (next: "dark" | "light") => {
    const root = document.documentElement;
    root.classList.add("theme-anim");
    root.dataset.theme = next;
    setTimeout(() => root.classList.remove("theme-anim"), 400);
    try {
      localStorage.setItem("tc-theme", next);
    } catch {
      /* private mode: the choice just won't persist */
    }
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark theme"
      onClick={() => set(dark ? "light" : "dark")}
      className="relative flex h-9 w-full items-center rounded-[11px] bg-surface-3 p-1 text-[13.5px] font-semibold"
    >
      <span
        aria-hidden="true"
        className="absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-[8px] bg-surface shadow-[var(--shadow-sm)] transition-[left] duration-300 ease-[cubic-bezier(0.3,1.2,0.4,1)]"
        style={{ left: dark ? "50%" : "4px" }}
      />
      <span className={`relative z-[1] flex flex-1 items-center justify-center gap-1.5 ${dark ? "text-muted" : ""}`}>
        <Sun size={15} /> Light
      </span>
      <span className={`relative z-[1] flex flex-1 items-center justify-center gap-1.5 ${dark ? "" : "text-muted"}`}>
        <Moon size={15} /> Dark
      </span>
    </button>
  );
}

function SpendCard({ data }: { data: StateView | null }) {
  if (!data) return <div className="skeleton h-[118px]" />;
  const pct = Math.min(100, (data.spend.committed.minor / Math.max(1, data.spend.monthlyCap.minor)) * 100);
  return (
    <div className="rounded-[14px] border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="label">This month</span>
        {data.mandate.paused ? (
          <span className="stamp stamp-stop">Paused</span>
        ) : (
          <span className="stamp stamp-go">Active</span>
        )}
      </div>
      <div className="figure mt-2 text-[24px]" data-testid="month-spend">
        <CountUp text={data.spend.committed.text} />
      </div>
      <div className="meter mt-3" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-[13px] text-muted">
        <span className="num">{data.spend.remaining.text}</span> left of{" "}
        <span className="num">{data.spend.monthlyCap.text}</span>
      </div>
    </div>
  );
}

function Sidebar({ path, data, onNavigate }: { path: string; data: StateView | null; onNavigate: () => void }) {
  const list = useRef<HTMLUListElement>(null);
  const [bar, setBar] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-current="page"]');
    setBar(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [path]);
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-3 px-2 pt-2">
        <Mark />
        <span>
          <span className="block text-[20px] leading-none font-extrabold tracking-[-0.03em]">TrueCart</span>
          <span className="mt-1 block text-[12.5px] text-muted">Landed-cost shopping agent</span>
        </span>
      </Link>
      <nav aria-label="Main">
        <ul ref={list} className="relative space-y-0.5">
          {bar && (
            <span
              aria-hidden="true"
              className="absolute right-0 left-0 rounded-[11px] bg-brand-soft transition-all duration-300 ease-[cubic-bezier(0.3,1.1,0.4,1)]"
              style={{ top: bar.top, height: bar.height }}
            />
          )}
          {NAV.map((n) => {
            const active = isActive(n.href, path);
            const Icon = n.icon;
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-3 rounded-[11px] px-3 py-2.5 text-[15px] transition-colors ${
                    active ? "font-semibold text-brand-text" : "text-ink-2 hover:bg-surface-3 hover:text-ink"
                  }`}
                >
                  <Icon size={19} className="transition-transform duration-200 group-hover:scale-110" />
                  {n.label}
                  {n.href === "/approvals" && data && data.awaitingApprovals > 0 && (
                    <span className="num ml-auto rounded-full bg-wait px-2 py-0.5 text-[12px] font-bold text-surface">
                      {data.awaitingApprovals}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-auto space-y-3">
        <SpendCard data={data} />
        <ThemeSwitch />
      </div>
    </div>
  );
}

/** Reveals [data-reveal] elements as they scroll into view, including ones that render after data loads. */
function useReveal(path: string) {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -8% 0px" },
    );
    const scan = () => document.querySelectorAll("[data-reveal]:not(.in)").forEach((el) => io.observe(el));
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [path]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data } = useApi<StateView>("/api/state");
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useReveal(path);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);
  const page = NAV.find((n) => isActive(n.href, path));
  const PageIcon = page?.icon;

  return (
    <div className="min-h-screen lg:pl-[264px]">
      {/* Sidebar: fixed on desktop, a drawer on smaller screens */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[264px] border-r border-border bg-surface-2 transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] lg:translate-x-0 ${
          open ? "translate-x-0 shadow-[var(--shadow-lg)]" : "-translate-x-full"
        }`}
      >
        <button
          className="icon-btn absolute top-4 right-3 lg:hidden"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        >
          <X size={20} />
        </button>
        <Sidebar path={path} data={data} onNavigate={() => setOpen(false)} />
      </aside>
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <header
        className={`sticky top-0 z-20 border-b transition-[background-color,border-color,box-shadow] duration-300 ${
          scrolled
            ? "border-border bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] shadow-[var(--shadow-sm)] backdrop-blur-md"
            : "border-transparent bg-bg"
        }`}
      >
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-3 px-4 sm:px-8">
          <button className="icon-btn -ml-2 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu size={21} />
          </button>
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            {PageIcon && <PageIcon size={18} className="text-brand-text" />}
            {page?.label ?? "TrueCart"}
            <span className="hidden font-normal text-muted sm:inline">· {page?.hint}</span>
          </span>
          <span className="ml-auto flex items-center gap-2">
            {data?.mandate.paused && <span className="stamp stamp-stop">Paused</span>}
            {data && data.awaitingApprovals > 0 && (
              <Link href="/approvals" className="stamp stamp-wait hover:opacity-80">
                {data.awaitingApprovals} waiting
              </Link>
            )}
            <span className="stamp stamp-plain hidden sm:inline-flex">PayPal sandbox</span>
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
        <div
          role="status"
          className="mt-2 rounded-[12px] border border-[color-mix(in_srgb,var(--warning)_25%,transparent)] bg-warning-soft px-4 py-2.5 text-[13.5px] text-ink-2"
        >
          Sandbox: no real money. Merchants are simulated. Shipping, tax and FX figures are estimates.
        </div>
        <main className="pt-8 pb-20">{children}</main>
        <footer className="border-t border-border py-6 text-[13px] text-muted">
          PayPal sandbox · Offers from Channel3 · Rates from Frankfurter · AI model: Gemini (free tier). Product names
          and stores are masked in demo mode.
        </footer>
      </div>
      <Toaster />
    </div>
  );
}
