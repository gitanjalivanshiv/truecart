// "Likely the same product" across markets (SPEC 5.5, revised after spike S4: Channel3 product ids are
// never shared across locales). Pure and deterministic. Always labelled fuzzy in the UI: never claimed exact.
//
// Two offers match when their brands are equal (case-insensitive) and their titles, with brand words,
// units and filler removed, are similar enough (Jaccard >= threshold) or identical.

export interface MatchableOffer {
  offerId: string;
  market: string;
  brand: string | null;
  title: string;
}

export interface ProductGroup {
  groupId: string;
  offerIds: string[];
  markets: string[];
  match: "identical-title" | "similar-title" | "single";
}

const FILLER = new Set(["the", "a", "an", "with", "and", "for", "of", "in", "by", "new", "-", "&"]);

export function titleTokens(title: string, brand: string | null): Set<string> {
  const brandWords = new Set(
    (brand ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  return new Set(
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !FILLER.has(t) && !brandWords.has(t) && !/^\d+(ml|l|oz|cm|mm)?$/.test(t)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Groups offers; every offer ends up in exactly one group. Groups are ordered by first offer id. */
export function groupProducts(offers: readonly MatchableOffer[], threshold = 0.6): ProductGroup[] {
  const sorted = [...offers].sort((x, y) => x.offerId.localeCompare(y.offerId));
  const parent = new Map(sorted.map((o) => [o.offerId, o.offerId]));
  const find = (id: string): string => (parent.get(id) === id ? id : find(parent.get(id)!));
  const tokens = new Map(sorted.map((o) => [o.offerId, titleTokens(o.title, o.brand)]));

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (!a.brand || !b.brand || a.brand.toLowerCase() !== b.brand.toLowerCase()) continue;
      const ta = tokens.get(a.offerId)!;
      const tb = tokens.get(b.offerId)!;
      const identical = ta.size > 0 && ta.size === tb.size && [...ta].every((t) => tb.has(t));
      if (!identical && jaccard(ta, tb) < threshold) continue;
      const ra = find(a.offerId);
      const rb = find(b.offerId);
      if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    }
  }

  const groups = new Map<string, MatchableOffer[]>();
  for (const o of sorted) {
    const r = find(o.offerId);
    groups.set(r, [...(groups.get(r) ?? []), o]);
  }
  const sameTokens = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((t) => b.has(t));
  return [...groups.entries()].map(([root, members]) => {
    const first = tokens.get(members[0].offerId)!;
    const allIdentical = members.every((m) => sameTokens(tokens.get(m.offerId)!, first));
    return {
      groupId: `grp_${root}`,
      offerIds: members.map((m) => m.offerId),
      markets: [...new Set(members.map((m) => m.market))].sort(),
      match: members.length === 1 ? "single" : allIdentical ? "identical-title" : "similar-title",
    };
  });
}
