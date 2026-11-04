# TrueCart

> **Sandbox only. No real money. Merchants are simulated.** All PayPal calls go to the PayPal sandbox; the server refuses to start against any other PayPal host. Shipping, import-tax and FX figures are **estimates**.

TrueCart is an AI shopping agent that buys within a spending mandate you set, ranks offers across markets by **true landed cost** (price + shipping + estimated import tax + estimated FX cost), pays through PayPal with a vaulted wallet, and cannot be talked out of its limits because the policy engine lives in the payment executor, not in the LLM.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com) (2026).

**Status:** working end to end in the PayPal sandbox: web app (Shop, Offers, Approvals, Ledger, Mandate, Red team), AI agent, landed-cost ranking, mandate policy, approvals, payments, webhooks and reconciliation. **Live demo: https://truecart-dm3w.onrender.com**

## Try the hosted demo

**https://truecart-dm3w.onrender.com** (free hosting: if it has been idle, the first load takes about a minute).

No login is needed. Each visitor gets their own workspace with a demo mandate (£150 per purchase, £400 a month, auto-buy up to £40) and a shared PayPal **sandbox** buyer wallet.

1. **Shop:** click the suggested request. The agent searches UK, US and German shops, ranks them by landed cost and buys the best one within the mandate. Watch the log and the PayPal activity.
2. **Offers:** see why the cheapest sticker price is not the cheapest purchase; click a row for the cost breakdown.
3. Ask for **3 bottles**: it goes to **Approvals** instead of being bought. Approve it there.
4. **Red team:** a listing that tries to hijack the agent. Run it through the agent, or simulate a fully hijacked agent: both are denied.
5. **Mandate:** change limits or pause everything, then try again.

Workspaces reset when the free server restarts.

### Connect your own AI agent (MCP)

TrueCart is also an MCP server. On the **Mandate** page, under **Connect an agent**, create a token and add the shown configuration to any MCP client that supports remote (streamable HTTP) servers with headers. The agent gets four tools (`get_mandate`, `search_offers`, `explain_offer`, `buy_within_mandate`) and shops inside exactly that mandate: the same limits, approval inbox and pause switch apply, and it cannot change them. Revoke the token at any time.

## Run locally

Requires Node.js 24 (see `.node-version`; 22.12+ works).

```bash
npm install
cp .env.example .env   # fill in sandbox credentials: docs/SETUP_CREDENTIALS.md
npm run dev            # http://localhost:3000, health at /api/health
```

For a fully offline, deterministic run (recorded product data and recorded AI runs; payments still go to the PayPal sandbox):

```bash
DEMO_MODE=true AGENT_MODE=replay npm run dev
```

### Credentials (all sandbox / test)

| Variable                                   | Where to get it                                                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox) > Apps & Credentials > **Sandbox** REST app                                                  |
| `PAYPAL_WEBHOOK_ID`                        | `npm run spike:webhook -- create --url https://<public-url>/api/webhooks/paypal`                                                                                                 |
| `GEMINI_API_KEY`                           | [aistudio.google.com](https://aistudio.google.com) > Get API key (free tier; Google may use free-tier inputs to improve its products, TrueCart only sends sandbox shopping data) |
| `DEMO_WALLET_TOKEN`                        | The sandbox buyer's Vault token printed by `npm run spike:vault -- token` (server-only)                                                                                          |
| `CHANNEL3_API_KEY`                         | [channel3.ai](https://channel3.ai)                                                                                                                                               |

### Sandbox buyer for judges

No login is needed for the hosted demo: every workspace starts with a shared PayPal **sandbox** buyer wallet (saved once through PayPal's Vault approval). To try linking your own wallet on the **Mandate** page, use any PayPal **sandbox** personal account (create one free under Testing Tools > Sandbox Accounts at developer.paypal.com). Never use a real PayPal login.

## What you can do

| Page          | What it shows                                                                                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shop**      | Ask the agent for a product. A live log shows every search, cost breakdown, mandate check and payment, next to the PayPal activity (orders, webhooks).                                                                                                                |
| **Offers**    | All offers from UK, US and German shops ranked by landed cost (toggle to sticker price), with a cost build-up bar, the mandate's decision per offer, and a line-by-line breakdown. Buy within the mandate from here too.                                              |
| **Approvals** | Purchases above your auto-buy limit, laid out like a declaration. Approve and pay, or reject.                                                                                                                                                                         |
| **Ledger**    | Spend against your caps; every purchase reconciled against PayPal's capture breakdown (fee model vs actual fee); deliveries with the PayPal tracking number, simulated carrier progress (+1 day / simulate a delay) and an evidence summary when a parcel is overdue. |
| **Mandate**   | Caps, auto-buy limit, max units, allowed shop countries, pause switch, and PayPal sandbox wallet linking.                                                                                                                                                             |
| **Red team**  | A synthetic hostile listing that tries to hijack the agent. Run it through the AI agent, or simulate a fully hijacked agent: both are denied by the mandate.                                                                                                          |

Each visitor gets their own workspace (anonymous cookie): their own mandate, approvals and ledger.

## Deploy (Render, free plan)

1. In Render: **New → Blueprint**, pick this repository. `render.yaml` defines the service.
2. Fill in the secret values Render asks for: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `DEMO_WALLET_TOKEN` (the sandbox buyer's Vault token from `npm run spike:vault`), `GEMINI_API_KEY`, `CHANNEL3_API_KEY`. Leave `PAYPAL_WEBHOOK_ID` empty for the first deploy.
3. After the first deploy, register the webhook: `npm run spike:webhook -- create --url https://<your-service>.onrender.com/api/webhooks/paypal`, put the returned id in `PAYPAL_WEBHOOK_ID` on Render, and redeploy.
4. Optional: set the GitHub repository variable `DEMO_URL` to the Render URL so `.github/workflows/keepalive.yml` pings it. GitHub runs scheduled jobs on a best-effort basis (often hours apart), so a free uptime monitor that requests `/api/health` every 10 minutes is the reliable way to keep the instance awake.

The free plan sleeps after 15 minutes without traffic (about a minute to wake) and its disk is not persistent: demo workspaces reset when the service restarts. The hosted demo runs with `DEMO_MODE=true` (recorded, anonymized product data) so it never spends Channel3 credits.

## Scripts

| Command                                                                                      | What it does                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`                                                            | Next.js dev server / production build / serve the build                                                                                                        |
| `npm test`                                                                                   | Unit tests (Vitest)                                                                                                                                            |
| `npm run test:e2e`                                                                           | Playwright end-to-end tests (builds and serves the app on port 3200 with recorded data)                                                                        |
| `npm run typecheck` · `lint` · `format`                                                      | Types, ESLint, Prettier                                                                                                                                        |
| `npm run demo:discover -- "insulated water bottle 1 litre"`                                  | CLI: offers from UK, US and German shops ranked by landed cost, with the mandate's decision (`--replay` uses recordings, `--unmasked` shows names)             |
| `npm run demo:chat -- "Get me a 1L insulated water bottle, delivered to the UK, under £40."` | Talk to the agent in the terminal (dry run by default; `--pay` charges in the PayPal sandbox; `--replay hero` uses a recorded run)                             |
| `npm run smoke:executor`                                                                     | One live sandbox purchase through the payment executor (needs the wallet vaulted by `spike:vault`)                                                             |
| `scripts/judge-smoke.sh <url> [--no-pay]`                                                    | The judges' path against a deployment: health, fresh workspace, ranking, hijacked-agent drill (must be denied), hero purchase (sandbox)                        |
| `npx tsx scripts/smoke/mcp-client.ts <url> <token> [--buy]`                                  | Connects to TrueCart's MCP server as an outside agent: lists tools, reads the mandate, searches, shows that 20 units are denied, optionally buys one (sandbox) |
| `npm run spike:<name>`                                                                       | Feasibility spikes: `vault`, `fx-orders`, `fx-quote`, `channel3`, `channel3-mcp`, `webhook`, `mcp` (see `scripts/spikes/`)                                     |

## Project layout

```
app/                Next.js App Router (UI + /api routes)
src/config/         sandbox guard
src/domain/         money · mandate · policy · approval · authorize · landedCost · fees (pure, no network)
src/executor/       the only code that can move money: reserve -> vaulted PayPal charge -> settle; webhooks; reconcile
src/agent/          provider-neutral tool-use agent (Gemini adapter), tools, injection guards
src/integrations/   paypal (client, webhooks) · channel3 (client, record/replay, normalize, mask) · fxrates
src/discovery/      query -> offers across markets -> landed cost -> ranking -> policy dry run
fixtures/           recorded Channel3 responses and FX rates (demo works offline with DEMO_MODE=true)
src/mcp/            TrueCart MCP server (/mcp): mandate-scoped tools for outside agents
src/db/             SQLite (node:sqlite): mandates, approvals, purchases, ledger, webhook events
scripts/spikes/     feasibility spikes (S1–S6)
tests/{unit,e2e}/   Vitest and Playwright
data/               import rules, simulated shipping lanes, fee table (sourced, dated)
docs/               DECISIONS.md (append-only), SPIKE_RESULTS.md, SETUP_CREDENTIALS.md
```

## Safety design (summary)

- Sandbox guard at boot and on every PayPal request (`src/config/sandbox.ts`).
- The AI model can search, rank and propose; only `src/executor/` can create or capture PayPal orders, after re-running the policy engine and verifying a cart-bound, single-use approval. The model only ever passes an offer ref and a quantity: prices, totals, countries and limits come from our own records.
- Money is integer minor units; the LLM never does arithmetic on money.
- Product text from merchants is untrusted data and cannot change limits or tool arguments.
- Every PayPal write carries a `PayPal-Request-Id` idempotency key; every external call has a timeout.

## Acknowledgements

The official [PayPal + AG Grid hackathon boilerplate](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate) was reviewed for API conventions and version pins; no code was copied (see `docs/DECISIONS.md`).

## Licence

[MIT](LICENSE)
