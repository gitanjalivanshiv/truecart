"use client";

import Link from "next/link";
import { PayPalActivity } from "./Activity";
import { AgentText, BoxHead } from "./bits";
import { StepList } from "./StepList";
import { useAgentChat } from "./useAgentChat";

const HERO = "Get me a 1L insulated water bottle, delivered to the UK, under £40.";

export function Shop() {
  const { send, busy, turns, steps, mode, searched, tokens, input, setInput } = useAgentChat();
  return (
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <section>
        <BoxHead no="01" title="Request" aside={mode && <span className="label">{mode}</span>} />
        <p className="mb-5 max-w-[60ch] text-ink-2">
          Ask for something delivered to the UK. TrueCart compares shops in the UK, US and Germany by what you would
          actually pay, then buys only within the limits on your{" "}
          <Link href="/mandate" className="underline underline-offset-2">
            mandate
          </Link>
          .
        </p>

        <div className="space-y-5">
          {turns.length === 0 && (
            <div className="sheet p-4 text-[13.5px]">
              <div className="label mb-2">Try</div>
              <button className="btn-link block text-left" onClick={() => send(HERO, "hero")} disabled={busy}>
                {HERO}
              </button>
              <p className="mt-3 text-[12.5px] text-muted">
                Product text from shops is treated as untrusted data. See{" "}
                <Link href="/red-team" className="underline underline-offset-2">
                  Red team
                </Link>{" "}
                for what happens when a listing tries to give orders.
              </p>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={t.who === "you" ? "" : "border-l-2 border-ink pl-4"}>
              <div className="speaker mb-1">{t.who === "you" ? "You" : "TrueCart"}</div>
              <div className={t.who === "you" ? "text-[15px]" : "text-[14.5px] leading-relaxed"}>
                {t.who === "agent" ? <AgentText text={t.text} /> : t.text}
              </div>
            </div>
          ))}
          {busy && (
            <div className="border-l-2 border-rule pl-4">
              <div className="speaker mb-1">TrueCart</div>
              <span className="text-muted">
                working<span className="blink">_</span>
              </span>
            </div>
          )}
        </div>

        <form
          className="mt-6 flex gap-2"
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
            className="field font-sans text-[14px]"
            placeholder="e.g. a 1L insulated bottle under £40"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={1000}
            disabled={busy}
          />
          <button className="btn btn-primary" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      </section>

      <aside className="space-y-10">
        <section>
          <BoxHead
            no="02"
            title="What the agent did"
            aside={tokens > 0 && <span className="label">{tokens.toLocaleString("en-GB")} tokens</span>}
          />
          {steps.length === 0 ? (
            <p className="text-[13px] text-muted">
              Each search, cost breakdown, mandate check and payment shows up here as it happens.
            </p>
          ) : (
            <StepList steps={steps} />
          )}
          {searched && (
            <Link href="/offers" className="btn mt-3">
              Open the full ranking
            </Link>
          )}
        </section>
        <PayPalActivity />
      </aside>
    </div>
  );
}
