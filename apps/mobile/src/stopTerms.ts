/** Pure display helpers: which list words each route stop covers. */

export type TermsById = Record<string, string[]>;

/** Build productId → terms in list order, no duplicate terms. Pure. */
export function buildTermsById(matched: Array<{ term: string; productId: string }>): TermsById {
  const out: TermsById = {};
  for (const m of matched) {
    const list = out[m.productId] ?? [];
    if (!list.includes(m.term)) list.push(m.term);
    out[m.productId] = list;
  }
  return out;
}

/** Append one card-picked term to a product's terms (no dupes). Pure. */
export function addCardTerm(prev: TermsById, productId: string, term: string): TermsById {
  const list = prev[productId] ?? [];
  if (list.includes(term)) return prev;
  return { ...prev, [productId]: [...list, term] };
}

/**
 * Suffix for a stop line, e.g. ` — eggs, milk`. Empty when the product
 * has no recorded terms, or the terms merely repeat the product name
 * (case-insensitive) — "Coffee" for Coffee adds nothing.
 */
export function termsSuffix(productId: string, productName: string, termsById: TermsById): string {
  const terms = termsById[productId] ?? [];
  if (terms.length === 0) return "";
  if (terms.every((t) => t.toLowerCase() === productName.toLowerCase())) return "";
  return ` — ${terms.join(", ")}`;
}
