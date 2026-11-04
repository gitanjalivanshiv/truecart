"use client";

import Link from "next/link";
import { PayPalActivity } from "./Activity";
import { AgentText, BoxHead } from "./bits";
import { Showcase } from "./Showcase";
import { StepList } from "./StepList";
import { useAgentChat } from "./useAgentChat";

const HERO = "Get me a 1L insulated water bottle, delivered to the UK, under £40.";

const HOW = [
  { title: "Search three markets", text: "Shops in the UK, the US and Germany, through Channel3." },
  {
    title: "Price it properly",
    text: "Item, shipping, UK import VAT and duty, and the cost of currency conversion: the landed cost.",
  },
  {
    title: "Check your mandate",
    text: "Caps, auto-buy limit, units and countries, enforced in the payment code, not by the AI.",
  },
  {
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
            <div className="label mb-4">AI shopping agent · PayPal sandbox · delivered to the UK</div>
            <h1 className="display text-[44px] sm:text-[60px]">
              The cheapest price tag isn&apos;t the <span className="mark">cheapest purchase</span>.
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
              <div className="label mb-2">Try it</div>
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
          <ol className="grid gap-px border-[1.5px] border-ink bg-ink sm:grid-cols-2 lg:grid-cols-4">
            {HOW.map((h, i) => (
              <li key={h.title} className="bg-sheet p-5">
                <div className="figure text-[32px] text-accent">0{i + 1}</div>
                <div className="mt-3 text-[17px] font-bold tracking-[-0.01em]">{h.title}</div>
                <p className="mt-1 text-[14px] text-ink-2">{h.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <PayPalActivity no="02" />
      </div>
    );

  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <section>
        <BoxHead no="01" title="Your request" aside={mode && <span className="label">{mode}</span>} />
        <div className="space-y-6">
          {turns.map((t, i) =>
            t.who === "you" ? (
              <div key={i} className="ml-auto max-w-[85%] bg-ink px-4 py-3 text-[16px] text-paper">
                {t.text}
              </div>
            ) : (
              <div key={i} className="card px-5 py-4">
                <div className="speaker mb-2">TrueCart</div>
                <div className="text-[15.5px] leading-relaxed">
                  <AgentText text={t.text} />
                </div>
              </div>
            ),
          )}
          {busy && (
            <div className="border-l-4 border-accent pl-4">
              <div className="speaker mb-1">TrueCart</div>
              <span className="text-[15px] text-ink-2">
                working through it<span className="blink">_</span>
              </span>
            </div>
          )}
        </div>
        <div className="mt-8">
          <Ask input={input} setInput={setInput} send={send} busy={busy} />
        </div>
      </section>

      <aside className="space-y-12">
        <section>
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
