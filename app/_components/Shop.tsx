"use client";

import { Calculator, CreditCard, Globe, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { PayPalActivity } from "./Activity";
import { AgentText, BoxHead } from "./bits";
import { Showcase } from "./Showcase";
import { StepList } from "./StepList";
import { useAgentChat } from "./useAgentChat";

const HERO = "Get me a 1L insulated water bottle, delivered to the UK, under £40.";

const HOW = [
  { icon: Globe, title: "Search three markets", text: "Shops in the UK, the US and Germany, through Channel3." },
  {
    icon: Calculator,
    title: "Price it properly",
    text: "Item, shipping, UK import VAT and duty, and the cost of currency conversion: the landed cost.",
  },
  {
    icon: ShieldCheck,
    title: "Check your mandate",
    text: "Caps, auto-buy limit, units and countries, enforced in the payment code, not by the AI.",
  },
  {
    icon: CreditCard,
    title: "Pay with PayPal",
    text: "Your saved PayPal wallet, no pop-up. Then PayPal's own record is checked against the ledger.",
  },
];

function Ask({
  input,
  setInput,
  send,
  busy,
  big,
}: {
  input: string;
  setInput: (v: string) => void;
  send: (m: string) => void;
  busy: boolean;
  big?: boolean;
}) {
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        send(input);
      }}
    >
      <label htmlFor="ask" className="sr-only">
        Your request
      </label>
      <input
        id="ask"
        className={`field font-sans ${big ? "py-3 text-[16px]" : "text-[15px]"}`}
        placeholder="Or ask for something else, e.g. a steel lunch box under £25"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        maxLength={1000}
        disabled={busy}
      />
      <button className={`btn ${big ? "btn-lg" : ""}`} disabled={busy || !input.trim()}>
        Send
      </button>
    </form>
  );
}

export function Shop() {
  const { send, busy, turns, steps, mode, searched, tokens, input, setInput } = useAgentChat();

  if (turns.length === 0 && !busy)
    return (
      <div className="space-y-16">
        <section className="grid items-center gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[13.5px] font-semibold text-ink-2 shadow-[var(--shadow-sm)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden="true" />
              AI shopping agent · PayPal sandbox · UK delivery
            </div>
            <h1 className="display text-[42px] sm:text-[58px]">
              The cheapest price tag isn&apos;t the <span className="text-brand-text">cheapest purchase</span>.
            </h1>
            <p className="mt-6 max-w-[54ch] text-[18px] leading-relaxed text-ink-2">
              TrueCart compares shops by what you would actually pay, then buys with PayPal only inside the limits on
              your{" "}
              <Link href="/mandate" className="font-semibold underline underline-offset-4">
                mandate
              </Link>
              . No AI can talk it past them.
            </p>
            <div className="mt-8">
              <div className="label mb-2">Try the demo request</div>
              <button
                className="btn btn-primary btn-lg w-full justify-between text-left"
                onClick={() => send(HERO, "hero")}
              >
                <span>{HERO}</span>
                <span aria-hidden="true">→</span>
              </button>
              <div className="mt-3">
                <Ask input={input} setInput={setInput} send={send} busy={busy} big />
              </div>
              <p className="mt-4 text-[13.5px] text-muted">
                Product text from shops is treated as untrusted data.{" "}
                <Link href="/red-team" className="font-semibold text-ink underline underline-offset-2">
                  See a listing try to hijack the agent
                </Link>
                .
              </p>
            </div>
          </div>
          <Showcase />
        </section>

        <section aria-labelledby="how">
          <h2 id="how" className="sr-only">
            How it works
          </h2>
          <div className="mb-5 flex items-end justify-between" data-reveal>
            <div>
              <div className="text-[14px] font-semibold text-brand-text">How it works</div>
              <div className="mt-1 text-[26px] font-extrabold tracking-[-0.025em]">
                Four checks before any money moves
              </div>
            </div>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW.map((h, i) => {
              const Icon = h.icon;
              return (
                <li
                  key={h.title}
                  className="card lift p-5"
                  data-reveal
                  style={{ "--d": `${i * 0.08}s` } as React.CSSProperties}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-brand-soft text-brand-text">
                      <Icon size={22} />
                    </span>
                    <span className="num text-[13px] font-semibold text-muted">Step {i + 1}</span>
                  </div>
                  <div className="mt-4 text-[17px] font-bold tracking-[-0.01em]">{h.title}</div>
                  <p className="mt-1 text-[14px] text-ink-2">{h.text}</p>
                </li>
              );
            })}
          </ol>
        </section>

        <div data-reveal>
          <PayPalActivity no="02" />
        </div>
      </div>
    );

  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <section>
        <BoxHead no="01" title="Your request" aside={mode && <span className="label">{mode}</span>} />
        <div className="space-y-6">
          {turns.map((t, i) =>
            t.who === "you" ? (
              <div
                key={i}
                className="fade-in ml-auto max-w-[85%] rounded-[16px] rounded-br-[6px] bg-brand px-4 py-3 text-[16px] text-[var(--brand-ink)]"
              >
                {t.text}
              </div>
            ) : (
              <div key={i} className="card fade-in px-5 py-4">
                <div className="speaker mb-2">TrueCart</div>
                <div className="text-[15.5px] leading-relaxed">
                  <AgentText text={t.text} />
                </div>
              </div>
            ),
          )}
          {busy && (
            <div className="card flex items-center gap-3 px-5 py-4">
              <span className="flex gap-1" aria-hidden="true">
                {[0, 1, 2].map((d) => (
                  <span
                    key={d}
                    className="h-2 w-2 animate-bounce rounded-full bg-brand"
                    style={{ animationDelay: `${d * 0.15}s` }}
                  />
                ))}
              </span>
              <span className="text-[15px] text-ink-2">TrueCart is working through it…</span>
            </div>
          )}
        </div>
        <div className="mt-8">
          <Ask input={input} setInput={setInput} send={send} busy={busy} />
        </div>
      </section>

      <aside className="space-y-6">
        <section className="card p-6">
          <BoxHead
            no="02"
            title="What the agent did"
            aside={tokens > 0 && <span className="label">{tokens.toLocaleString("en-GB")} tokens</span>}
          />
          {steps.length === 0 ? (
            <p className="text-[14px] text-muted">
              Each search, cost breakdown, mandate check and payment shows up here as it happens.
            </p>
          ) : (
            <StepList steps={steps} />
          )}
          {searched && (
            <Link href="/offers" className="btn mt-4">
              Open the full ranking →
            </Link>
          )}
        </section>
        <PayPalActivity />
      </aside>
    </div>
  );
}
