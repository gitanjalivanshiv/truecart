# TrueCart

> **Sandbox only. No real money. Merchants are simulated.** All PayPal calls go to the PayPal sandbox; the server refuses to start against any other PayPal host. Shipping, import-tax and FX figures are **estimates**.

TrueCart is an AI shopping agent that buys within a spending mandate you set, ranks offers across markets by **true landed cost** (price + shipping + estimated import tax + estimated FX cost), pays through PayPal with a vaulted wallet, and cannot be talked out of its limits because the policy engine lives in the payment executor, not in the LLM.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com) (2026).

**Status:** Phase 0/1. Scaffold, sandbox guard and feasibility spikes are done; the product is not built yet. See [`docs/SPIKE_RESULTS.md`](docs/SPIKE_RESULTS.md).

## Run locally

Requires Node.js 24 (see `.node-version`; 22.12+ works).

```bash
npm install
cp .env.example .env   # fill in sandbox credentials (see below)
npm run dev            # http://localhost:3000, health at /api/health
```

### Credentials (all sandbox / test)

| Variable                                   | Where to get it                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox) > Apps & Credentials > **Sandbox** REST app |
| `PAYPAL_WEBHOOK_ID`                        | `npm run spike:webhook -- create --url https://<public-url>/api/webhooks/paypal`                                                |
| `ANTHROPIC_API_KEY`                        | [console.anthropic.com](https://console.anthropic.com)                                                                          |
| `CHANNEL3_API_KEY`                         | [channel3.ai](https://channel3.ai)                                                                                              |

### Sandbox buyer for judges

_Placeholder: a sandbox personal (GB) buyer login will be listed here and in the Devpost testing instructions. It is a PayPal sandbox test account and cannot move real money._

## Scripts

| Command                                 | What it does                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`       | Next.js dev server / production build / serve the build                                                                    |
| `npm test`                              | Unit tests (Vitest)                                                                                                        |
| `npm run test:e2e`                      | Playwright end-to-end tests (starts the dev server)                                                                        |
| `npm run typecheck` · `lint` · `format` | Types, ESLint, Prettier                                                                                                    |
| `npm run spike:<name>`                  | Feasibility spikes: `vault`, `fx-orders`, `fx-quote`, `channel3`, `channel3-mcp`, `webhook`, `mcp` (see `scripts/spikes/`) |

## Project layout

```
app/                Next.js App Router (UI + /api routes)
src/config/         sandbox guard
src/domain/         money · mandate · policy · landedCost (pure, no network)        [Phase 2]
src/executor/       the only code that can move money                               [Phase 2]
src/agent/          Claude tool-use loop                                            [Phase 2]
src/integrations/   paypal (client, webhooks) · channel3 · fxrates · anthropic
src/mcp/            TrueCart MCP server                                             [P1]
src/db/             SQLite                                                          [Phase 2]
scripts/spikes/     feasibility spikes (S1–S6)
tests/{unit,e2e}/   Vitest and Playwright
docs/               DECISIONS.md (append-only), SPIKE_RESULTS.md
```

## Safety design (summary)

- Sandbox guard at boot and on every PayPal request (`src/config/sandbox.ts`).
- The LLM can search, rank and propose; only `src/executor/` can create or capture PayPal orders, after re-running the policy engine and verifying a cart-bound, single-use approval.
- Money is integer minor units; the LLM never does arithmetic on money.
- Product text from merchants is untrusted data and cannot change limits or tool arguments.
- Every PayPal write carries a `PayPal-Request-Id` idempotency key; every external call has a timeout.

## Acknowledgements

The official [PayPal + AG Grid hackathon boilerplate](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate) was reviewed for API conventions and version pins; no code was copied (see `docs/DECISIONS.md`).

## Licence

[MIT](LICENSE)
