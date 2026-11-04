# Decisions (append-only)

Format: date (IST) · decision · reason.

## 2026-10-31 · Clean scaffold, do not reuse the PayPal + AG Grid boilerplate code

- **Checked:** `github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate` (public, last push 2026-10-12). Read README, package.json, `lib/paypal.ts`.
- **Finding:** no `LICENSE` file, no `license` field in package.json, GitHub license detection returns `null`. Without a licence the code is all-rights-reserved by default, which conflicts with our MIT licence and the "original work, solely owned" rule.
- **Also:** its scope is a read-only reporting dashboard (catalog/plans/invoices/transactions/balances + AG Studio + OpenAI assistant). It has no Orders, Vault, webhook or policy code we would reuse.
- **Decision:** scaffold with `create-next-app@16.4.3` (App Router, TS, Tailwind). Copy no code. We take only public facts from it: version pins (AG Grid 36.2.0) and the documented REST behaviours in its README (token caching, retries, decimal-string amounts). Credit it in README as inspiration.

## 2026-10-31 · Stack pins

- Next.js 16.4.3 (Turbopack, Cache Components on by default in the template), React 19.3, Tailwind 4.3, Node 24 (`.node-version`).
- TypeScript **5.9.3**, not 7.0: TS 7 (native port) is newer than our tooling's tested range; zero benefit for a 12-day build.
- Vitest 5.0.5, Playwright 1.64.1, Prettier 3.9, ESLint 9 (Next flat config) + eslint-config-prettier.
- zod 4.6.7 at every boundary. `tsx` runs spike/seed scripts with tsconfig path aliases.
- Dependencies are added in the phase that first uses them (fast-check, better-sqlite3, AG Grid, Anthropic SDK in Phase 2).

## 2026-10-31 · Channel3 via REST + zod, not `@channel3/sdk`

- The SDK (4.6.0) is Fern-generated and wraps responses in a pager object. Record/replay fixtures need the exact raw JSON.
- Docs specify the REST contract (`POST https://api.trychannel3.com/v1/search`, `x-api-key`, `config.{country,currency,language}`), so a ~50-line typed fetch client is simpler and has no extra dependency.

## 2026-10-31 · Sandbox guard design

- `src/config/sandbox.ts` `assertSandboxUrl(value, service)` accepts only exactly `https://api-m.sandbox.paypal.com` (api) or `https://mcp.sandbox.paypal.com` (mcp): no other host, port, credentials, path, query or fragment. Unset means sandbox.
- Enforced twice: at boot (`instrumentation-node.ts` exits the process with code 1, verified against `next start`) and on every PayPal request (`src/integrations/paypal/client.ts`). Error messages never echo the rejected value.

## 2026-10-31 · PayPal REST via plain fetch, no SDK

- One client (`src/integrations/paypal/client.ts`): cached client-credentials token, 15s timeout per call (`AbortSignal.timeout`), typed `PayPalApiError` (status, debug_id, issue, redacted body) and `PayPalTimeoutError`, one retry on 401, and **every non-GET requires a `PayPal-Request-Id`** (enforced by code, not convention).

## 2026-10-31 · Webhook verification: self-verify first, postback as fallback

- PayPal docs recommend self-verification (CRC32 of raw body + cert from `paypal-cert-url`). We allowlist the cert host (`*.paypal.com`, https, no port) so an attacker cannot point us at their own certificate. Simulator mock events only self-verify (webhook id `WEBHOOK_ID`).

## 2026-10-31 · FX fallback source: Frankfurter v2

- `https://api.frankfurter.dev/v2/rates?base=GBP&quotes=USD,EUR`: no key, no quotas (abuse rate-limited), daily, blended central-bank sources, free for commercial use. Behind the `FxRateSource` interface; rates kept as decimal strings. Verified live 2026-10-31.

## 2026-10-31 · Exact BigInt rationals for FX/bps maths instead of a decimal library

- SPEC 5.1 suggests a decimal library for rates. We only ever multiply minor units by a rate or by basis points and round once, so parsing decimal-string rates into BigInt `num/10^scale` is exact, has zero dependencies, and makes "no floats" checkable by grep. Rounding modes: HALF_EVEN (display lines), CEIL (policy worst case), HALF_UP (fee model), FLOOR.

## 2026-10-31 · Policy additions beyond SPEC 5.3

- `maxUnitsPerPurchase` on the mandate (default 3): blocks "buy 20 units" injections even when 20 cheap units fit under the cap.
- `LOW_CONFIDENCE_ESTIMATE` escalates to NEEDS_APPROVAL; `WALLET_NOT_LINKED` and `MANDATE_MISMATCH` deny.
- All reasons are reported, not just the first. Monthly window = UTC calendar month. Ledger PENDING entries reserve the CEIL worst case; the executor must refuse a capture above the reservation (property-tested invariant: committed spend never exceeds the monthly cap).
- Approvals bind mandate, offer, merchant, quantity, amount and currency (SPEC listed offer/merchant/amount/currency/expiry); they unlock NEEDS_APPROVAL only and can never override DENIED.

## 2026-10-31 · Landed-cost model for a GB buyer

- Rules live in `data/import_rules.json` (verified against gov.uk on 2026-10-31): consignment intrinsic value ≤ £135 (excl. shipping and VAT) means the seller charges 20% UK VAT at checkout (so it is part of the PayPal charge and incurs the FX spread) and no duty. Above £135, import VAT and commodity-specific duty are paid to the carrier. Duty is not estimated (`null`), and that forces low confidence, which forces approval.
- DE offers: assume listed prices include 19% German VAT, removed on export. This is an explicit, labelled assumption ("retailer practice varies").
- Shipping is always from the simulated lane table (`data/shipping_table.json`), because Channel3 offers have no shipping data.
- The FX spread is applied to the PayPal-charged amount only when order currency ≠ funding currency. 300 bps is UNCONFIRMED (see SPIKE_RESULTS) and is always labelled estimate.
- Confidence: high = no estimated inputs; medium = 1–2 (simulated shipping always counts); low = 3+, or any unknown (country, rule, route, duty).
- Merchant fees (3.49% + fixed, +1.50% intl; PayPal page updated 2026-10-01) are seller-side only and are never added to the buyer total.
- Ranking: sticker = listed price at the base rate; true = landed total; ties broken by offer id. `vsStickerLeader.drivers` are code-computed deltas per line kind. The LLM may phrase them but never computes them.

## 2026-11-02 · Demo product: insulated water bottle (open decision 13.2, owner-approved)

- S4 showed cross-market overlaps (same branded bottles in GB/US and GB/DE), a wide price spread, and every offer under the £135 VAT threshold. Brands are masked in demo mode.

## 2026-11-02 · SQLite via Node's built-in `node:sqlite`, not better-sqlite3

- better-sqlite3 needs a native install script, which npm 11's allow-scripts blocks by default (here and in CI/Render) and which can break on Node upgrades. Node 24 ships `node:sqlite` (`DatabaseSync`): synchronous, safe-integer preserving, no dependency. Verified: compare-and-set via `changes`, `BEGIN IMMEDIATE` transactions.
- Money-guarding writes run in one `BEGIN IMMEDIATE` transaction (`src/db/reserveCharge.ts`): re-run policy against the stored ledger, consume the approval by compare-and-set, reserve the worst case as PENDING, insert the purchase. PayPal is called after commit.
- `PayPal-Request-Id = tc-` + sha256(mandateId, proposalId)[:32]. Replaying a proposal returns the same purchase; buying the same item again needs a new proposal.
- Captures can never exceed the reservation: enforced in code and by a CHECK constraint.

## 2026-11-02 · Executor design (SPEC 5.6, 5.7)

- `buy()` is the only path to a charge: `reserveCharge` (policy + approval CAS + worst-case reservation) → mark SUBMITTED → vaulted MIT order → record the outcome and settle the ledger in one transaction.
- Retries (timeout, network, 429, 5xx) reuse the same `PayPal-Request-Id`, which PayPal honours (spike S1), so they never double-charge. If the outcome is still unknown after 3 attempts the reservation is kept and `reconcile()` re-sends with the same id later (default after 5 min).
- Terminal failures are classified from PayPal's documented issue codes (DECLINED / WALLET / MERCHANT / CONFIG). They fail the purchase and release the reservation.
- `invoice_id = custom_id = purchaseId`: a second PayPal-side duplicate guard, and how webhooks find the purchase.
- A RESERVED purchase that was never submitted is re-checked for pause, expiry and an unlinked wallet before submitting.
- A captured amount that differs from the approved amount is recorded with a `CAPTURED_AMOUNT_MISMATCH` warning.
- Webhooks:
  - only our webhook id (never the simulator's `WEBHOOK_ID`);
  - 503 on verifier outage (PayPal retries), 400 on a bad signature or hostile cert URL;
  - de-duplicated by event id;
  - `VAULT.PAYMENT-TOKEN.DELETED` unlinks the wallet;
  - the first cert fetch gets a 20 s timeout.
- Migration 1 was edited in place (purchase statuses SUBMITTED/PENDING, capture columns) before any database existed. Migrations are append-only from the first deploy.
- Verified live 2026-11-02 (`npm run smoke:executor`): GBP 5.00 and USD 7.00 purchases CAPTURED; a replayed proposal returned the same order and capture with no new charge.

## 2026-11-02 · Discovery pipeline (SPEC 5.5, revised by spike S4)

- **Record/replay.** Live mode records every Channel3 response under `fixtures/channel3/` and falls back to the recording on 402/429/timeout/5xx. `DEMO_MODE=true` replays only (no credits spent). In replay mode, an unseen query uses the closest recorded query for the same market (word overlap ≥ 0.5), and the market note says so. FX rates are recorded the same way (`fixtures/fx/`).
- **Normalization is the trust boundary for merchant data:**
  - prices go `String(number)` → strict decimal parser, and anything with float noise is dropped;
  - control, zero-width and bidi characters are stripped, and line separators become spaces;
  - text lengths are capped.
- **Merchant country** comes from a country-code TLD or a uk./us./de. subdomain (`domain`), else the search market (`locale`, flagged). Offers from countries outside the mandate are denied by policy.
- **Cross-market matching** is fuzzy because Channel3 ids differ per market: same brand plus title-token Jaccard ≥ 0.6 (brand words, units and filler removed). It is labelled "identical-title" or "similar-title" and never claimed to be exact. Unbranded offers are never grouped.
- **MASK_BRANDS (default on):** brands become "Brand A…", stores "Store GB-1…", and images are hidden. Titles keep only words on a generic-vocabulary **allowlist**, because a brand blocklist missed product-line trademarks in S4 data. Display only: real values stay in the data.
- **Live result 2026-11-02**, hero query "insulated water bottle 1 litre" (36 offers across GB/US/DE): the cheapest sticker (US, $13.99) ranks #5 by landed cost (£26.75); the true #1 is a GB offer at £18.99. Belgian and Australian stores were DENIED (country not in the mandate).

## 2026-11-03 · Provider-neutral agent; Gemini free tier as the live model (owner decision: no paid API credits)

- `ModelAdapter` interface (`src/agent/types.ts`). The loop, tools and guards never depend on a provider. Adapters:
  - Gemini (REST `generateContent`; the raw model turn is replayed verbatim to keep `thoughtSignature`);
  - scripted (tests);
  - replay/recording (demo fallback).
- Gemini free tier, checked 2026-11-03 on aistudio.google.com:
  - `gemini-2.5-flash` and several Gemini 3.x flash/flash-lite models are free;
  - rate limits are per project and shown in AI Studio;
  - **free-tier inputs may be used by Google to improve its products**, so only sandbox data is sent and the README says so.
  - Default model `gemini-2.5-flash` (configurable via `GEMINI_MODEL`).
- **The model never supplies money values.** Tool arguments are a query, an offer ref ("o3"), a quantity or a proposal id. The server re-prices with the same engine and quotes and builds the intent itself. Schemas are strict (unknown fields rejected), so "price" or "approved" cannot be smuggled.
- **Guards:**
  - unknown tools are refused;
  - tool arguments are validated;
  - per-turn caps: 6 model calls, 1,024 output tokens per call, 60,000 tokens per turn;
  - history trimmed to the last 6 user turns;
  - a final answer claiming a purchase the executor did not confirm gets an explicit "no payment was made" note.
- **Approval inbox:** NEEDS_APPROVAL creates a proposal holding the exact intent. Approving uses a compare-and-set on the proposal status (no double execution) and then runs the normal executor path, which re-runs the policy.
- **Red team:** a synthetic hostile listing (reserved `example.com` domain, labelled synthetic) under `fixtures/channel3/redteam/`, query "red team demo listing". Tests drive a model that obeys it: quantity 20 is DENIED by policy, an invented `update_mandate` tool is refused, smuggled `price`/`approved` fields are rejected, and the false "purchase complete" claim is corrected. No PayPal call; mandate unchanged.
- **Recorded conversations** (`fixtures/agent/`) are only ever saved from real model runs (`demo:chat --record`), never written by hand. Tools still execute live when replaying.

## 2026-11-03 · Gemini live results and model choice

- `gemini-2.5-flash` returns 404 "no longer available to new users". At the time of testing, `gemini-3.8-flash` timed out and `gemini-flash-latest` returned 503 "high demand" on the free tier. **`gemini-3.5-flash-lite` answered immediately, with tools and thought signatures**, so it is the default (`GEMINI_MODEL`). The adapter retries a 503 or timeout once on the same model, never a different one, because thought signatures are model-specific.
- **Live runs (real Gemini + replayed Channel3 data):**
  - Hero request: search → explain → policy dry run → propose. With `--pay`, the executor charged EUR 28.93 in the PayPal sandbox (`COMPLETED`); the ledger recorded the £24.89 landed estimate against a £25.39 worst-case reservation. About 15k input tokens over 5 model calls.
  - Red-team listing: Gemini flagged the injected instructions as untrusted, ignored them and asked before buying 1 unit.
  - User asks for 20 units of the red-team item: Gemini proposed 20 and the policy DENIED it (QUANTITY_EXCEEDS_LIMIT, EXCEEDS_PER_PURCHASE_CAP, ABOVE_APPROVAL_THRESHOLD). Gemini reported the denial accurately. Nothing was charged.
  - The free tier rate-limited (429) a run mid-conversation, which confirms the need for the recorded fallback.
- **Bug found by replaying the recorded hero run in dry-run mode:** the claim guard missed "purchase has been completed" and "CAPTURED". It is now broad (any capture/bought/paid wording, or purchase/order/payment near completion words), with regression tests. A false positive only appends a true statement.

## 2026-11-03 · Web UI

- **Visual language:** a customs declaration crossed with a bank statement.
  - Paper/ink palette with one restrained set of status colours (ledger green, approval amber, customs red).
  - Hairline rules, numbered form boxes, stamped statuses, tabular mono figures.
  - Square corners, no shadows or gradients, no icon library.
  - Type: Schibsted Grotesk (text) and IBM Plex Mono (figures, codes). Light and dark themes.
- **AG Grid Community** (master/detail and row grouping are Enterprise-only), themed via `themeQuartz.withParams` to the same tokens. The offer breakdown is a side panel rather than a detail row.
- **Per-visitor workspaces:** `proxy.ts` (Next 16's renamed middleware) sets an anonymous id cookie; each visitor gets their own mandate, approvals and ledger, so judges never share caps. New workspaces may use the shared sandbox buyer wallet (`DEMO_WALLET_TOKEN`, server-only) or link their own sandbox wallet through the Vault flow.
- **One purchase path:** the agent tool and the Offers "Buy" button both call `src/agent/purchase.ts`. The browser sends ids only.
- **Limits:**
  - per visitor: 12 agent turns / 10 min, 20 searches / 10 min;
  - global: 300 agent turns per day (`AGENT_DAILY_TURNS`).
- **Recorded fallback:** demo requests replay recorded real runs when the live model is busy or over its limits, but **only if the failed live turn proposed nothing** (never repeat a purchase). `AGENT_MODE=replay` forces it for tests or quota exhaustion. The UI always labels a recorded run.
- **Masking:** a mid-payment ledger row briefly showed a raw store domain (it joined on a field set only after payment). Purchases now join their proposal by id, and no view falls back to raw ids or domains. PayPal payloads in the activity panel have personal payer/address fields redacted.
- Route handlers re-throw Next.js control-flow errors (`unstable_rethrow`) so prerender bail-outs are not turned into 500s.

## 2026-11-03 · Public repo carries anonymized Channel3 data only

- Channel3's guidance allows light caching to power your own UI; long-term storage or bulk export needs their agreement, and offer URLs must be fetched fresh. Publishing raw recordings (titles, descriptions, brands, images, buy links) goes beyond that.
- **Committed (`fixtures/channel3/public/`, made by `scripts/fixtures/anonymize-channel3.ts`):**
  - kept: product ids (Channel3: safe to cache indefinitely), prices, currencies, availability;
  - changed: titles reduced to generic words; pseudonymous brands and store domains that keep country hints;
  - dropped: descriptions, images, links.
  - Ranking, matching and replay are unchanged.
- Raw live recordings go to `data/channel3-cache/` (git-ignored); FX live recordings to `data/fx-cache/`. Raw recordings were removed from git history before the first push.
- Store labels are now numbered by best rank within each country ("Store GB-1" = best UK store) and keyed by country + domain. Previously a `.com` store listed in two markets shared one label.
- A stray "1l insulated bottle" recording made the hero query resolve to a set without the price flip. It was removed, and the hero run was re-recorded from live Gemini (it buys the true #1, £18.99).
- Recorded runs never replay a PayPal order id (replay creates a new order). Ids are scrubbed on save and on load.

## 2026-11-03 · TrueCart MCP server (SPEC 5.10)

- `/mcp`, streamable HTTP, **stateless**: one `McpServer` + `WebStandardStreamableHTTPServerTransport` per request, JSON responses. It suits a single free instance that may restart at any time.
- **Auth:** `Authorization: Bearer tc_mcp_…`, a mandate token created by the person on the Mandate page (shown once, stored as a sha256 hash, revocable, max 5 active, 60 requests / 10 min per token). Missing, unknown or revoked → 401.
- **Tools:**
  - `get_mandate`, `search_offers`, `explain_offer` (all read-only);
  - `buy_within_mandate` (the shared purchase path: the policy re-runs, above the auto-buy limit goes to the person's approval inbox, the executor pays).
  - No tool can change limits. Each token's searches are separate, and offers are referenced by ids we issued.
- **Verified 2026-11-03** over HTTP against a production build with the SDK client: 401 without a token; 4 tools; 20 units DENIED; 1 unit CAPTURED in the sandbox; the revoked token was refused.

## 2026-11-03 · Shipment tracking (SPEC 5.8)

- **Verified from PayPal's Orders v2 OpenAPI schema:**
  - `POST /v2/checkout/orders/{id}/track` takes `capture_id`, `tracking_number` (≤64), `carrier` (1,451-value enum incl. ROYAL_MAIL, USPS, DHL, OTHER) and `notify_payer`, and returns the order with `purchase_units[].shipping.trackers[]` (id `<capture>-<tracking>`).
  - **Tracker status is only SHIPPED or CANCELLED**: PayPal has no delivery states.
- **Design:**
  - After capture (auto and approval paths), the simulated merchant registers a real PayPal tracker. Carrier by shop country: ROYAL_MAIL / USPS / DHL, shown as "UK post / US post / German courier".
  - Carrier progress (label, transit, customs for cross-border, out for delivery, delivered) is **simulated and labelled**, with a time machine (+1 day, simulate a delay, reset).
  - Overdue = more than 2 days past the expected days from the shipping table. It shows an evidence summary and a sandbox Resolution Center link (no automatic dispute: the buyer-side Disputes API is gated, F7).
- Tracking never affects payment: a tracker failure is stored on the shipment and shown. `ensureShipments` ships captured purchases missed by the post-capture hook (e.g. captured by webhook).
- The agent has a `track_deliveries` tool and is told to surface overdue parcels.
- **Verified live 2026-11-03:** a sandbox purchase from a US shop got tracker `9BF51690H49954839-TC6115277401US`.

## 2026-11-04 · PayPal Agent Toolkit as an independent, read-only check

- **Dependency:** `@paypal/agent-toolkit` 1.11.0, pinned exactly (it brings its own transitive dependencies, including zod 3 and axios; npm keeps them separate from ours). It is PayPal's official toolkit for agents and the only working way to call PayPal's MCP tools in the sandbox today: the hosted server lists tools but every call fails (`docs/SPIKE_RESULTS.md`, S6).
- **Use:** the toolkit's MCP server runs in-process (`src/integrations/paypal/toolkit.ts`) with two read actions: `get_order` and `get_shipment_tracking`. After a payment, the agent calls `confirm_with_paypal`, and the Ledger offers "Check with PayPal". Both compare PayPal's own record with the ledger: status, amount, capture, invoice id (our purchase id), fee, tracking.
- **Safety:**
  - No toolkit write tool is enabled, and the connection fails if any other tool is exposed. Money still moves only through `src/executor/`.
  - The toolkit's API base is asserted to be the sandbox, because the toolkit defaults to production.
  - The model passes only a `proposal_id`; the order id comes from our records.
  - Payer name and e-mail in PayPal's response are dropped before anything reaches the model or the UI.
- **Agent limits:** the step limit is raised from 6 to 8 so a turn can search, explain, buy, confirm and answer. A step or token stop after a capture now says the purchase went through.
- The hero recording was re-recorded with the live model (it now buys o1 and confirms with PayPal). On replay, the recorded `proposal_id` is replaced with the one this run produced.

## 2026-11-04 · AG Grid: Community features only

- **Verified** against the installed `ag-grid-community` 36.2.0 type definitions. Everything used is in `AllCommunityModule`: `CsvExport`, `QuickFilter`, `ExternalFilter`, `PinnedRow`, `Tooltip`, `RowStyle` and `HighlightChanges`. `grandTotalRow` needs the Enterprise row-grouping module, so totals are pinned rows (`pinnedBottomRowData`) computed on the server. The browser never sums money.
- **Offers:**
  - market buttons and "only what my mandate allows" (external filter);
  - a text filter (quick filter) with a "N of M shown" count from `getDisplayedRowCount()`;
  - row rules for the best offer and for refused offers;
  - a cost breakdown tooltip on the landed cost;
  - CSV export of exactly what is shown.
- **Ledger:** paid totals per charge currency pinned under the purchases, and CSV export.
- **CSV safety:**
  - Product titles come from third-party listings, so every exported cell goes through `csvSafe`. It prefixes cells starting with `= + @`, a tab, a CR, or `-` not followed by a digit, so spreadsheets don't run them as formulas (OWASP CSV injection).
  - Every file starts with a sandbox/estimates label.
- **Auto-height:** AG Grid keeps a 150px minimum on auto-height grids for its empty overlay. The ledger shows its own empty state, so the minimum is removed there.
