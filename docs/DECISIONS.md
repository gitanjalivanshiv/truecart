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
