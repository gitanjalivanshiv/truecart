"use client";

import { useState } from "react";
import { BoxHead } from "./bits";
import { ConnectAgent } from "./ConnectAgent";
import type { StateView } from "./types";
import { post, refreshAll, useApi } from "./useApi";

const COUNTRIES: [string, string][] = [
  ["GB", "United Kingdom"],
  ["US", "United States"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["NL", "Netherlands"],
  ["BE", "Belgium"],
  ["IE", "Ireland"],
  ["IT", "Italy"],
  ["ES", "Spain"],
  ["AU", "Australia"],
];

const WALLET_MESSAGES: Record<string, string> = {
  linked: "Your PayPal sandbox wallet is linked.",
  cancelled: "Linking was cancelled at PayPal. Nothing changed.",
  expired: "That link attempt expired. Start again.",
  "not-approved": "PayPal did not confirm the approval. Nothing changed.",
};

async function patch(body: unknown) {
  const res = await fetch("/api/mandate", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Could not save.");
  return json as StateView;
}

const plain = (text: string) => text.replace(" GBP", "");

function LimitsForm({ state }: { state: StateView }) {
  const m = state.mandate;
  const [form, setForm] = useState({
    perPurchaseCap: plain(m.perPurchaseCap.text),
    monthlyCap: plain(m.monthlyCap.text),
    approvalThreshold: plain(m.approvalThreshold.text),
    maxUnitsPerPurchase: m.maxUnitsPerPurchase,
    allowedMerchantCountries: m.allowedMerchantCountries,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const money = (k: "perPurchaseCap" | "monthlyCap" | "approvalThreshold", label: string, hint: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <span className="code text-muted">£</span>
        <input
          className="field max-w-[140px]"
          inputMode="decimal"
          value={form[k]}
          onChange={(e) => set(k, e.target.value)}
        />
      </div>
      <span className="mt-1 block text-[12px] text-muted">{hint}</span>
    </label>
  );
  return (
    <form
      className="grid gap-x-10 gap-y-5 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await patch(form);
          setMsg({ ok: true, text: "Saved. New limits apply to the next purchase." });
          refreshAll();
        } catch (err) {
          setMsg({ ok: false, text: (err as Error).message });
        }
      }}
    >
      {money("perPurchaseCap", "Per-purchase cap", "Never pay more than this for one purchase, approved or not.")}
      {money("monthlyCap", "Monthly cap", "Total across all purchases this calendar month (UTC).")}
      {money("approvalThreshold", "Auto-buy up to", "Above this the agent must ask you first.")}
      <label className="block">
        <span className="label">Max units per purchase</span>
        <input
          type="number"
          min={1}
          max={100}
          className="field mt-1 block max-w-[100px]"
          value={form.maxUnitsPerPurchase}
          onChange={(e) => set("maxUnitsPerPurchase", Math.max(1, Number(e.target.value) || 1))}
        />
        <span className="mt-1 block text-[12px] text-muted">Stops “buy 20” tricks even when the price is small.</span>
      </label>
      <fieldset className="md:col-span-2">
        <legend className="label mb-2">Shops may be in</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {COUNTRIES.map(([code, name]) => (
            <label key={code} className="flex items-center gap-1.5 text-[13.5px]">
              <input
                type="checkbox"
                className="accent-[var(--ink)]"
                checked={form.allowedMerchantCountries.includes(code)}
                onChange={(e) =>
                  set(
                    "allowedMerchantCountries",
                    e.target.checked
                      ? [...form.allowedMerchantCountries, code]
                      : form.allowedMerchantCountries.filter((c) => c !== code),
                  )
                }
              />
              <span className="code text-[12px] text-muted">{code}</span> {name}
            </label>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          Import rules are only modelled for UK, US and German shops; others will need your approval because their costs
          are uncertain.
        </p>
      </fieldset>
      <div className="flex items-center gap-4 md:col-span-2">
        <button className="btn btn-primary">Save limits</button>
        {msg && <span className={msg.ok ? "text-go" : "text-stop"}>{msg.text}</span>}
      </div>
    </form>
  );
}

export function Mandate({ walletStatus }: { walletStatus?: string }) {
  const { data: state } = useApi<StateView>("/api/state");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refreshAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!state) return null;
  const m = state.mandate;
  return (
    <div className="space-y-12">
      <section>
        <BoxHead no="01" title="Purchases" />
        <div className="flex flex-wrap items-center gap-4">
          {m.paused ? <span className="stamp stamp-stop">Paused</span> : <span className="stamp stamp-go">Active</span>}
          <button
            className={`btn ${m.paused ? "btn-primary" : "btn-danger"}`}
            disabled={busy}
            onClick={() => run(() => patch({ paused: !m.paused }))}
          >
            {m.paused ? "Resume purchases" : "Pause all purchases"}
          </button>
          <span className="text-[13px] text-ink-2">
            {m.paused
              ? "The agent can still search and compare, but nothing will be bought."
              : "Pausing stops every purchase immediately, including approved ones not yet paid."}
          </span>
        </div>
      </section>

      <section>
        <BoxHead no="02" title="Limits" />
        <LimitsForm key={JSON.stringify(m)} state={state} />
      </section>

      <section>
        <BoxHead no="03" title="PayPal wallet" aside={<span className="label">sandbox</span>} />
        {walletStatus && WALLET_MESSAGES[walletStatus] && (
          <p className={`mb-3 ${walletStatus === "linked" ? "text-go" : "text-wait"}`}>
            {WALLET_MESSAGES[walletStatus]}
          </p>
        )}
        <p className="mb-4 text-[13.5px]">
          {state.wallet.linked
            ? state.wallet.kind === "shared-sandbox-buyer"
              ? "Using the shared sandbox buyer account. Purchases are charged to it without a PayPal pop-up, within your limits."
              : "Using your own PayPal sandbox wallet, linked through PayPal."
            : "No wallet linked. The agent can compare offers but cannot pay."}
        </p>
        <div className="flex flex-wrap gap-2">
          {state.wallet.demoWalletAvailable && state.wallet.kind !== "shared-sandbox-buyer" && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => run(() => post("/api/wallet", { action: "use-demo" }))}
            >
              Use the shared sandbox buyer
            </button>
          )}
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const { approveUrl } = await post<{ approveUrl: string }>("/api/wallet/start", {});
                window.location.assign(approveUrl);
              })
            }
          >
            Link a PayPal sandbox account
          </button>
          {state.wallet.linked && (
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => run(() => post("/api/wallet", { action: "unlink" }))}
            >
              Unlink
            </button>
          )}
        </div>
        <p className="mt-3 max-w-[70ch] text-[12px] text-muted">
          Linking uses PayPal&apos;s saved-payment approval (sandbox). You approve once at PayPal; after that, payments
          within your limits happen without a redirect. Use a PayPal sandbox personal account, not a real one.
        </p>
        {error && <p className="mt-2 text-stop">{error}</p>}
      </section>

      <section>
        <BoxHead no="04" title="Fixed for this demo" />
        <dl className="grid max-w-[640px] grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13.5px]">
          <dt className="label pt-0.5">Delivered to</dt>
          <dd>United Kingdom ({m.buyerCountry})</dd>
          <dt className="label pt-0.5">You pay in</dt>
          <dd>{m.fundingCurrency}</dd>
          <dt className="label pt-0.5">Shop currencies</dt>
          <dd className="code">{m.allowedOrderCurrencies.join(" · ")}</dd>
          <dt className="label pt-0.5">FX buffer</dt>
          <dd>{m.maxFxSlackBps / 100}% added to foreign-currency totals before checking caps</dd>
          <dt className="label pt-0.5">Expires</dt>
          <dd className="num">
            {new Date(m.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </dd>
        </dl>
      </section>

      <ConnectAgent />
    </div>
  );
}
