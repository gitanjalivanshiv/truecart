// Agent tools. The model may pass only: a search query, an offer ref, a quantity, a proposal id.
// Every price, total, country and limit comes from our own records and engines (project rule: the LLM never
// moves money and never does money arithmetic). Schemas are strict: unknown fields are rejected.

import { z } from "zod";
import { getMandate, ledgerForMandate } from "@/src/db/repositories";
import { getProposal } from "@/src/db/proposals";
import { committedThisMonth } from "@/src/domain/ledger";
import { agentView } from "@/src/domain/mandate";
import { landedCost, type LandedCost } from "@/src/domain/landedCost";
import { toDecimalString, type Money } from "@/src/domain/money";
import { evaluate, type PurchaseIntent } from "@/src/domain/policy";
import { discover } from "@/src/discovery/discover";
import { costingContextFor, rankDiscovery } from "@/src/discovery/rank";
import { getQuotes } from "@/src/integrations/fxrates/resilient";
import type { AgentSession, OfferRef } from "./session";
import type { ToolSpec } from "./types";
import { merchantText, UNTRUSTED_NOTE } from "./untrusted";
import { proposePurchase as proposeShared } from "./purchase";

const fmt = (m: Money) => `${toDecimalString(m)} ${m.currency}`;
const MAX_RESULTS = 10;

export class ToolInputError extends Error {
  override name = "ToolInputError";
}

export interface AgentTool<A> {
  spec: ToolSpec;
  schema: z.ZodType<A>;
  run(session: AgentSession, args: A): Promise<unknown>;
}

function mandateOf(s: AgentSession) {
  const m = getMandate(s.db, s.mandateId);
  if (!m) throw new ToolInputError("mandate not found");
  return m;
}

function lookup(s: AgentSession, ref: string): OfferRef {
  const r = s.refs.get(ref);
  if (!r) throw new ToolInputError(`unknown offer ref "${ref}". Use a ref returned by search_offers.`);
  return r;
}

/** Re-prices an offer for a quantity with the same engine and quotes used for ranking. */
function costFor(s: AgentSession, r: OfferRef, quantity: number): LandedCost {
  const o = r.row.offer;
  return landedCost(
    {
      offerId: o.offerId,
      merchantId: o.merchantId,
      merchantCountry: o.merchantCountry,
      countrySource: o.countrySource,
      unitPrice: o.unitPrice,
      quantity,
    },
    costingContextFor(mandateOf(s), r.quotes),
  );
}

function intentFor(s: AgentSession, r: OfferRef, cost: LandedCost, quantity: number): PurchaseIntent {
  return {
    mandateId: s.mandateId,
    offerId: r.row.offer.offerId,
    merchantId: r.row.offer.merchantId,
    merchantCountry: r.row.offer.merchantCountry,
    orderAmount: cost.charged,
    landedTotal: cost.total,
    quantity,
    confidence: cost.confidence,
  };
}

const lines = (c: LandedCost) =>
  c.lines.map((l) => ({ kind: l.kind, amount: fmt(l.amount), estimate: l.estimate, basis: l.basis }));

const Quantity = z.number().int().min(1).max(100);
const Ref = z.string().regex(/^o\d{1,3}$/);

const searchOffers: AgentTool<{ query: string; quantity?: number }> = {
  spec: {
    name: "search_offers",
    description:
      "Search offers for a product across the UK, US and Germany and rank them by estimated true landed cost. Returns offer refs.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Short product search, e.g. 'insulated water bottle 1 litre'" },
        quantity: { type: "integer", description: "Units wanted (default 1)", minimum: 1, maximum: 100 },
      },
      required: ["query"],
    },
  },
  schema: z.strictObject({ query: z.string().trim().min(2).max(120), quantity: Quantity.optional() }),
  async run(s, { query, quantity = 1 }) {
    const mandate = mandateOf(s);
    const discovery = await discover(query, { mode: s.discoveryMode });
    const currencies = [...new Set(discovery.offers.map((o) => o.unitPrice.currency))];
    const fx = await getQuotes(mandate.currency, currencies, { mode: s.discoveryMode });
    const now = s.now();
    const { rows } = rankDiscovery(discovery, {
      mandate,
      ledger: ledgerForMandate(s.db, mandate.id),
      quotes: fx.quotes,
      quantity,
      maskBrands: s.maskBrands,
      now,
    });

    s.onSearch?.({ query, quantity, rows, quotes: fx.quotes, fxSource: fx.source, discovery });
    const top = rows.slice(0, MAX_RESULTS).map((row) => {
      const ref = `o${s.nextRef++}`;
      s.refs.set(ref, { ref, row, quotes: fx.quotes, query });
      return { ref, row };
    });
    const refOf = new Map(top.map((t) => [t.row.offerId, t.ref]));
    const sticker = rows.find((r) => r.stickerRank === 1);
    return {
      query,
      quantity,
      _note: UNTRUSTED_NOTE,
      estimates:
        "Shipping is simulated; import VAT/duty and FX costs are estimates. Merchants are simulated in the PayPal sandbox.",
      fx: { source: fx.source, rates: fx.quotes.map((q) => `${q.from}->${q.to} ${q.rate} (${q.asOf})`) },
      markets: discovery.markets.map((m) => ({
        country: m.country,
        source: m.source,
        offers: m.offerCount,
        ...(m.note && { note: m.note }),
      })),
      total_offers_ranked: rows.length,
      offers: top.map(({ ref, row }) => ({
        ref,
        merchant_text: merchantText(row.display.title, row.offer.description),
        store: row.display.merchant,
        merchant_country: row.offer.merchantCountry,
        country_basis:
          row.offer.countrySource === "domain"
            ? "store domain"
            : row.offer.countrySource === "locale"
              ? "search market (inferred)"
              : "unknown",
        price: fmt(row.offer.unitPrice),
        landed_total_estimate: fmt(row.total),
        true_rank: row.trueRank,
        sticker_rank: row.stickerRank,
        confidence: row.confidence,
        mandate_decision: row.policy.decision,
        mandate_reasons: row.policy.reasons,
        likely_same_product_as: discovery.groups
          .find((g) => g.groupId === row.groupId && g.offerIds.length > 1)
          ?.offerIds.filter((id) => id !== row.offerId)
          .map((id) => refOf.get(id))
          .filter(Boolean),
      })),
      cheapest_sticker: sticker
        ? {
            ref: refOf.get(sticker.offerId) ?? "not in top results",
            sticker_price: fmt(sticker.offer.unitPrice),
            true_rank: sticker.trueRank,
          }
        : null,
    };
  },
};

const explainRanking: AgentTool<{ ref: string }> = {
  spec: {
    name: "explain_ranking",
    description:
      "Cost breakdown for one offer (price, shipping, VAT/duty, FX) and how it compares to the cheapest-sticker offer. Use these numbers verbatim.",
    parameters: {
      type: "object",
      properties: { ref: { type: "string", description: "Offer ref from search_offers, e.g. o2" } },
      required: ["ref"],
    },
  },
  schema: z.strictObject({ ref: Ref }),
  async run(s, { ref }) {
    const r = lookup(s, ref);
    const row = r.row;
    const leaderRef = [...s.refs.values()].find((x) => x.row.offerId === row.vsStickerLeader?.offerId)?.ref;
    return {
      ref,
      quantity_priced: row.lines.find((l) => l.kind === "item")?.basis,
      lines: lines(row),
      landed_total_estimate: fmt(row.total),
      charged_by_paypal: fmt(row.charged),
      confidence: row.confidence,
      warnings: row.warnings,
      vs_cheapest_sticker: row.vsStickerLeader
        ? {
            cheapest_sticker_ref: leaderRef ?? "not in top results",
            total_difference: fmt({ amountMinor: row.vsStickerLeader.totalDeltaMinor, currency: row.total.currency }),
            drivers: row.vsStickerLeader.drivers.map((d) => ({
              kind: d.kind,
              difference: fmt({ amountMinor: d.deltaMinor, currency: row.total.currency }),
            })),
          }
        : "this is the cheapest-sticker offer",
    };
  },
};

const checkPolicy: AgentTool<{ ref: string; quantity: number }> = {
  spec: {
    name: "check_policy",
    description:
      "Dry run: would this purchase be bought automatically, need the user's approval, or be denied by the mandate? Moves no money.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Offer ref" },
        quantity: { type: "integer", description: "Units", minimum: 1, maximum: 100 },
      },
      required: ["ref", "quantity"],
    },
  },
  schema: z.strictObject({ ref: Ref, quantity: Quantity }),
  async run(s, { ref, quantity }) {
    const r = lookup(s, ref);
    const cost = costFor(s, r, quantity);
    const p = evaluate(mandateOf(s), ledgerForMandate(s.db, s.mandateId), intentFor(s, r, cost, quantity), s.now());
    return {
      ref,
      quantity,
      decision: p.decision,
      reasons: p.reasons,
      landed_total_estimate: fmt(cost.total),
      worst_case_with_fx_buffer:
        p.worstCaseTotalMinor === null ? null : fmt({ amountMinor: p.worstCaseTotalMinor, currency: p.currency }),
      remaining_this_month: fmt({ amountMinor: p.remainingMonthlyMinor, currency: p.currency }),
    };
  },
};

const proposePurchase: AgentTool<{ ref: string; quantity: number }> = {
  spec: {
    name: "propose_purchase",
    description:
      "Propose buying an offer. The payment system (not you) decides: buy now within the mandate, send to the user's approval inbox, or deny.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Offer ref" },
        quantity: { type: "integer", description: "Units", minimum: 1, maximum: 100 },
      },
      required: ["ref", "quantity"],
    },
  },
  schema: z.strictObject({ ref: Ref, quantity: Quantity }),
  async run(s, { ref, quantity }) {
    const r = lookup(s, ref);
    const res = await proposeShared(
      { db: s.db, mandateId: s.mandateId, sessionId: s.id, gateway: s.gateway, now: s.now },
      r.row,
      r.quotes,
      quantity,
    );
    if (res.status === "DENIED") {
      return {
        status: "DENIED",
        proposal_id: res.proposalId,
        reasons: res.policy.reasons,
        message: "The mandate does not allow this purchase. Nothing was charged.",
      };
    }
    if (res.status === "AWAITING_APPROVAL") {
      return {
        status: "AWAITING_APPROVAL",
        proposal_id: res.proposalId,
        reasons: res.policy.reasons,
        landed_total_estimate: fmt(res.cost.total),
        message: "Sent to the user's approval inbox. Nothing is charged until they approve.",
      };
    }
    if (res.status === "DRY_RUN") {
      return {
        status: "DRY_RUN",
        message: "Within the mandate and would be bought automatically, but payments are disabled in this session.",
      };
    }
    const outcome = res.outcome;
    return {
      status: outcome.status,
      proposal_id: res.proposalId,
      ...(outcome.status === "CAPTURED" && {
        paypal_order_id: outcome.orderId,
        charged: fmt(res.cost.charged),
        landed_total_estimate: fmt(res.cost.total),
      }),
      ...(outcome.status === "DENIED" && { reasons: outcome.reasons }),
      ...(outcome.status === "FAILED" && { failure: outcome.code }),
      ...("message" in outcome && { message: outcome.message }),
    };
  },
};

const getOrderStatus: AgentTool<{ proposal_id: string }> = {
  spec: {
    name: "get_order_status",
    description: "Current status of a proposal made in this conversation (awaiting approval, captured, failed...).",
    parameters: {
      type: "object",
      properties: { proposal_id: { type: "string", description: "proposal_id from propose_purchase" } },
      required: ["proposal_id"],
    },
  },
  schema: z.strictObject({ proposal_id: z.string().regex(/^prop_[0-9a-f-]{36}$/) }),
  async run(s, { proposal_id }) {
    const p = getProposal(s.db, proposal_id);
    if (!p || p.sessionId !== s.id) throw new ToolInputError("unknown proposal");
    return {
      proposal_id,
      proposal_status: p.status,
      payment_status: p.outcome?.status ?? null,
      title: p.display.title,
      landed_total_estimate: p.display.landedTotal,
    };
  },
};

const getMandateSummary: AgentTool<Record<string, never>> = {
  spec: {
    name: "get_mandate_summary",
    description:
      "The user's spending mandate: caps, approval threshold, allowed countries/currencies, remaining budget.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  schema: z.strictObject({}),
  async run(s) {
    const m = mandateOf(s);
    const v = agentView(m);
    const money = (minor: number) => fmt({ amountMinor: minor, currency: m.currency });
    const spent = committedThisMonth(ledgerForMandate(s.db, m.id), m.id, m.currency, s.now());
    return {
      per_purchase_cap: money(v.perPurchaseCapMinor),
      monthly_cap: money(v.monthlyCapMinor),
      spent_or_reserved_this_month: money(spent),
      remaining_this_month: money(Math.max(0, v.monthlyCapMinor - spent)),
      auto_buy_up_to: money(v.approvalThresholdMinor),
      max_units_per_purchase: v.maxUnitsPerPurchase,
      allowed_merchant_countries: v.allowedMerchantCountries,
      allowed_order_currencies: v.allowedOrderCurrencies,
      buyer_country: v.buyerCountry,
      paused: v.paused,
      expires_at: v.expiresAt,
      wallet_linked: v.walletLinked,
    };
  },
};

export const TOOLS: Record<string, AgentTool<never>> = Object.fromEntries(
  [searchOffers, explainRanking, checkPolicy, proposePurchase, getOrderStatus, getMandateSummary].map((t) => [
    t.spec.name,
    t as AgentTool<never>,
  ]),
);
export const TOOL_SPECS: ToolSpec[] = Object.values(TOOLS).map((t) => t.spec);
