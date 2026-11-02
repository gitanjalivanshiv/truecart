# Spike results (Phase 1)

Status key: **PASS** confirmed by a live run · **PARTIAL** part confirmed live · **DOCS-ONLY** contract verified in official docs, live run blocked · **FAIL**.
All runs are PayPal **sandbox**. Spike output is redacted; raw ids stay in git-ignored `scripts/spikes/.out/`.

_Last updated: 2026-11-02. PayPal sandbox credentials available; Channel3 key pending._

| #   | Spike                                                        | Status                                                           | Script                                                        | Chosen fallback                                                    |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| S1  | Vault v3 + merchant-initiated charge                         | DOCS-ONLY (blocked: PayPal creds + GB buyer)                     | `npm run spike:vault -- setup\|status\|token\|charge\|replay` | One buyer approval per purchase (`spike:fx-orders -- approve`)     |
| S2  | GBP/EUR orders on US business; `seller_receivable_breakdown` | DOCS-ONLY (blocked: PayPal creds)                                | `npm run spike:fx-orders`                                     | Model fee/FX, label "estimate"                                     |
| S3  | FX quote API access                                          | PARTIAL (fallback live PASS; PayPal side blocked)                | `npm run spike:fx-quote`                                      | **Frankfurter v2** (live PASS)                                     |
| S4  | Channel3 GB/US/DE                                            | DOCS-ONLY (blocked: Channel3 key)                                | `npm run spike:channel3`                                      | Fixtures + simulated shipping table (needed regardless, see below) |
| S5  | Webhook receive + signature verify                           | PARTIAL (verifier unit-tested; live blocked: creds + public URL) | `npm run spike:webhook -- serve\|list\|create\|simulate`      | Poll order status                                                  |
| S6  | PayPal hosted sandbox MCP                                    | DOCS-ONLY (blocked: PayPal creds)                                | `npm run spike:mcp`                                           | Local `@paypal/mcp` or direct REST for ops views                   |

---

## S1 · Vault v3 and merchant-initiated charge

**Docs verified** ([save PayPal, no purchase](https://developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/), [Orders v2 payment_source](https://developer.paypal.com/api/orders/v2/definitions/payment_source)):

1. `POST /v3/vault/setup-tokens` with `payment_source.paypal = { usage_type: "MERCHANT", customer_type: "CONSUMER", usage_pattern, permit_multiple_payment_tokens: false, experience_context: { brand_name, locale, return_url, cancel_url } }` returns `status: PAYER_ACTION_REQUIRED` plus a `rel: approve` link. The setup token expires after 3 days.
2. The buyer approves at the link (browser, sandbox personal account).
3. `POST /v3/vault/payment-tokens` with `{ payment_source: { token: { id: <setup token>, type: "SETUP_TOKEN" } } }` returns the payment token `id` (= `vault_id`) and `customer.id`.
4. `POST /v2/checkout/orders` with `intent: CAPTURE` and `payment_source.paypal = { vault_id, stored_credential: { payment_initiator: "MERCHANT", usage: "SUBSEQUENT", usage_pattern } }`.
   - `paypal.stored_credential` fields: `payment_initiator` (**required**: `CUSTOMER`|`MERCHANT`), `usage` (`FIRST`|`SUBSEQUENT`|`DERIVED`, default `DERIVED`), `usage_pattern` (`IMMEDIATE`, `DEFERRED`, `RECURRING_*`, `THRESHOLD_*`, `SUBSCRIPTION_*`, `UNSCHEDULED_PREPAID|POSTPAID`, `INSTALLMENT_*`). `charge_pattern` is deprecated.
   - `payment_type` and `previous_network_transaction_reference` exist **only for cards**, not the PayPal wallet.
   - PayPal troubleshooting note: `usage_pattern` must match between the setup token and the order, otherwise you get a 422.
   - Docs say "Payers don't need to be present when charged". **No redirect is expected; a live run must confirm.**

- **Our choice:** `usage_pattern: UNSCHEDULED_PREPAID` (agent buys at irregular times, and the charge happens before fulfilment). The script accepts `--pattern` to try others.
- **Live run checklist:** setup → approve as GB buyer → `token` → `charge --currency USD` (record status `COMPLETED` vs `APPROVED`/`PAYER_ACTION_REQUIRED`, latency) → `replay` (same `PayPal-Request-Id` must return the same order) → `charge --no-stored-credential` (does the order still go through?).
- **Live result 2026-11-02: PASS.**
  - Setup token → `PAYER_ACTION_REQUIRED`, then approved in the browser by the GB sandbox buyer → `APPROVED`. Payment token created; its response echoes `usage_type: MERCHANT`, `customer_type: CONSUMER`, `usage_pattern: UNSCHEDULED_PREPAID`, the buyer's GB shipping address and `payer_id`.
  - `POST /v2/checkout/orders` with `payment_source.paypal.vault_id` + `stored_credential {MERCHANT, SUBSEQUENT, UNSCHEDULED_PREPAID}` returned **`status: COMPLETED` with the capture already done, in one call (~3.6s), with no redirect or payer action**. So the executor does not call `/capture` for vaulted orders; it reads `purchase_units[0].payments.captures[0]`.
  - **Idempotency:** re-sending the same `PayPal-Request-Id` returned the _same_ order and capture ids (no double charge).
  - Without `stored_credential` the sandbox also completed the charge. We still always send it, because it is the correct signal for a merchant-initiated charge.
  - Fee calibration: USD 12.34 → `paypal_fee` 1.11 = our model exactly (3.49% 0.43 + intl 1.50% 0.19 + 0.49).
- **Fallback if no MIT charge:** buyer-approved order per purchase. The approval inbox then doubles as the PayPal approval step. Script: `spike:fx-orders -- approve`.

## S2 · Multi-currency orders on one US business account

- **Script:** charges USD/GBP/EUR 10.00 via the vault token and prints each capture's `seller_receivable_breakdown` (`gross_amount`, `paypal_fee`, `net_amount`, `receivable_amount`, `exchange_rate`).
- **Docs/community:** a US business account may block or hold currencies it doesn't hold. The setting is **Account Settings → Payment preferences → Block payments** (allow, convert to USD, or ask each time). Record which choice yields `exchange_rate` + `receivable_amount` in the breakdown. "Convert" is what we want, because it gives real FX data for reconciliation.
- **Live result 2026-11-02: PASS.** Vaulted MIT charges of 10.00 USD / GBP / EUR all `COMPLETED` on the US business account. No receiving-preference change was needed (or it was already set).

  |     | gross | paypal_fee | our model | net  | receivable_amount | exchange_rate     | vs Frankfurter mid (2026-11-02) |
  | --- | ----- | ---------- | --------- | ---- | ----------------- | ----------------- | ------------------------------- |
  | GBP | 10.00 | 0.89       | 0.89 ✓    | 9.11 | 11.86 USD         | 1.301739879661924 | 1.3393 → 2.80% below            |
  | EUR | 10.00 | 0.89       | 0.89 ✓    | 9.11 | 9.94 USD          | 1.090842204431814 | 1.11841 → 2.47% below           |
  - `receivable_amount = net × exchange_rate`, so conversion happens on the seller's net.
  - These are **seller-side** conversion figures from sandbox rates. They calibrate the merchant panel, not the buyer spread (F6 still applies), and sandbox rates may not match production. The executor should store `exchange_rate` as the full decimal string.

- **Fallback:** a modelled merchant fee/FX labelled "estimate"; the reconciliation view shows captured gross only.

## S3 · Currency Exchange quote API

- **Docs:** `POST /v2/pricing/quote-exchange-rates`, `quote_items[]: { base_currency, base_amount, quote_currency, markup_percent?, fx_id? }`. The response includes `exchange_rate_quotes[]` with `fx_id`, `exchange_rate`, `rate_refresh_time`, `expiry_time`. It requires the OAuth scope `https://uri.paypal.com/services/pricing/quote-exchange-rates/read`. The spike checks whether our token's `scope` list contains it before calling.
- **Fallback, live PASS 2026-10-31:** Frankfurter v2 `GET https://api.frankfurter.dev/v2/rates?base=GBP&quotes=USD,EUR` returned `GBP→EUR 1.1964`, `GBP→USD 1.337` (asOf 2026-10-31) in ~3.3s. No key needed, daily updates, free for commercial use. Implemented as `src/integrations/fxrates/frankfurter.ts` behind `FxRateSource`.
- **Live result 2026-11-02:** the client-credentials token **does** include the `.../pricing/quote-exchange-rates/read` scope (31 scopes in total), but `POST /v2/pricing/quote-exchange-rates` returns **403 `FEATURE_NOT_PROVISIONED`** (debug_id ca544ea29ec9f). The feature must be provisioned by PayPal for the account. Decision: Frankfurter is the rate source; FXaaS stays P2 and is only worth asking PayPal about if time allows.

## S4 · Channel3 multi-locale

**Docs verified** ([localization](https://channel3.mintlify.dev/docs/guides/localization.md), [search API](https://channel3.mintlify.dev/docs/api-reference/v1/search.md), [offer](https://channel3.mintlify.dev/docs/guides/offer.md)):

- `POST https://api.trychannel3.com/v1/search`, header `x-api-key`. The body takes `query`, `limit` (≤30), `page_token`, `filters` (default new + InStock), and `config: { country, currency, language }`. Countries include **GB, US, DE**; currencies include GBP, USD, EUR.
- A product has `id` (the "canonical product" across retailers), `title`, `brands[]`, `images[]`, `category`, `offers[]`, `variants`.
- An offer has `url`, `domain`, `price: { price, compare_at_price, currency }`, `availability` (InStock|OutOfStock), `condition`, `max_commission_rate`, `dimensions`.
- **There is no shipping cost, delivery time, merchant country or GTIN field.** So:
  - Shipping and delivery come from `data/shipping_table.json` for **every** offer (`shippingSource: "simulated"`). This is the primary path, not a fallback.
  - Merchant country is inferred from offer `domain` TLD (`.co.uk`→GB, `.de`→DE), else from the search locale, and flagged low confidence when ambiguous (`.com`).
- **Unknown until a live run:** whether product `id`s are shared across locales, and whether `price.currency` always equals the requested currency. The script measures both, plus title-overlap, TLD distribution and the branded share, for 3 candidate generic categories. It records raw responses to `fixtures/channel3/`.
- **Keyless probe:** Channel3's free-tier MCP (`https://mcp.trychannel3.com/`, `npm run spike:channel3-mcp -- --list-only`) works without a key, but its `search_products` takes only `query`/`image_url`/`thread_id`, with **no locale params**. It can't answer S4. Needs the API key.

## S5 · Webhooks

- **Implemented:** `src/integrations/paypal/webhooks.ts`.
  - Self-verification signs `transmission_id|transmission_time|webhook_id|crc32(raw body)` with SHA256withRSA against the cert at `paypal-cert-url` (https `*.paypal.com` only, cached, expiry-checked).
  - Postback verification uses `POST /v1/notifications/verify-webhook-signature` (raw event re-sent byte-for-byte).
  - Unit tests with a locally generated RSA key cover valid, tampered body, wrong webhook id, and hostile cert URLs. **PASS.**
- **Live run needs:** PayPal creds plus a public HTTPS URL. No tunnel is installed (`cloudflared`/`ngrok` absent). Options: `brew install cloudflared` and `cloudflared tunnel --url http://localhost:8787`, or deploy the receiver to Render.
  - Steps: `serve` → `create --url` → put the id in `PAYPAL_WEBHOOK_ID` → `simulate`, which proves self-verify with `WEBHOOK_ID` (postback is unsupported for mock events).
  - Then a real `PAYMENT.CAPTURE.COMPLETED` from an S1 charge proves both methods.

## S6 · PayPal hosted sandbox MCP

- **Docs:** sandbox `https://mcp.sandbox.paypal.com/http` (streamable HTTP) and `/sse`. Headless auth uses `Authorization: Bearer <access token from client credentials>`. The environment is chosen by host. The local alternative is `npx -y @paypal/mcp --tools=all` with `PAYPAL_ACCESS_TOKEN` and `PAYPAL_ENVIRONMENT=SANDBOX`. The docs don't state token lifetime; the spike records `expires_in`.
- **Script:** connects (streamable HTTP, then SSE as fallback), lists tools, and calls nothing.
- **Live result 2026-11-02:**
  - **SSE `https://mcp.sandbox.paypal.com/sse` with `Authorization: Bearer <client-credentials token>` works**: connected in ~1.6s and listed **46 tools**, including `get_order`, `list_transactions`, `create_shipment_tracking`, `get_shipment_tracking`, `list_disputes`, `get_dispute`, `create_order`, `pay_order`, `create_refund`, plus invoicing, subscription and catalog tools.
  - Streamable HTTP returned 404 at `/http` (the documented path), `/http/`, `/mcp` and `/`.
  - The access token's `expires_in` is **32,399 s (9 h)**, so the server must refresh it before reconnecting.
  - Decision: use SSE for the read/ops view (order lookup, tracking). Never expose MCP write tools (`create_order`, `pay_order`, `create_refund`) to our agent: payments stay on the executor's direct REST path.

---

## Buyer-side FX spread (SPEC 5.4, F12) · unresolved

- The PayPal UK consumer fees page (updated 22 Jan 2026) says purchases are free "unless it involves a currency conversion". The only percentage shown, "3% above the base exchange rate", sits under the business-account / receiver-bears heading. The page doesn't clearly state the consumer purchase spread.
- **Action:** keep the spread as a config constant with a source note and "estimate" label. Don't encode a number we can't cite. The UI shows the source link. Re-check the full UK fees legal page in Phase 2.
