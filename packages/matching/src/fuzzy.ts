import Fuse from "fuse.js";
import type { StoreProduct } from "@quickaisle/schema";
import { normalize } from "./normalize.ts";

/** Similarity ≥ this accepts without AI (Fuse distance ≤ 0.15). */
export const FUZZY_ACCEPT = 0.85;
/** Similarity in [FUZZY_GRAY, FUZZY_ACCEPT) goes to AI with suggestions. */
export const FUZZY_GRAY = 0.6;

interface FuzzyEntry {
  text: string;
  productId: string;
  name: string;
}

export interface FuzzyHit {
  productId: string;
  name: string;
  /** 0–1; 1 is an exact normalized-text match. */
  similarity: number;
}

/**
 * One entry per product name + one per catalog alias, all normalized.
 * Build once per catalog and reuse: search itself is cheap.
 */
export function buildFuzzyIndex(products: StoreProduct[]): Fuse<FuzzyEntry> {
  const entries: FuzzyEntry[] = [];
  for (const p of products) {
    const name = normalize(p.name);
    if (name) entries.push({ text: name, productId: p.id, name: p.name });
    for (const a of p.aliases ?? []) {
      const t = normalize(a);
      if (t) entries.push({ text: t, productId: p.id, name: p.name });
    }
  }
  return new Fuse(entries, {
    keys: ["text"],
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.6,
    minMatchCharLength: 2,
  });
}

/**
 * Best hit per product, exact normalized-text equality first (breaks ties
 * like "ice" → Ice/Juice/Rice where Fuse scores all three 1.0), then by
 * similarity. Returns at most `limit` hits.
 */
export function fuzzyMatch(
  term: string,
  fuse: Fuse<FuzzyEntry>,
  limit = 3,
): FuzzyHit[] {
  const n = normalize(term);
  if (!n) return [];
  const best = new Map<string, { hit: FuzzyHit; exact: boolean }>();
  for (const r of fuse.search(n)) {
    const sim = 1 - (r.score ?? 1);
    const exact = r.item.text === n;
    const cur = best.get(r.item.productId);
    const cand = {
      hit: {
        productId: r.item.productId,
        name: r.item.name,
        similarity: exact ? 1 : sim,
      },
      exact,
    };
    if (
      !cur ||
      (cand.exact && !cur.exact) ||
      (cand.exact === cur.exact && cand.hit.similarity > cur.hit.similarity)
    ) {
      best.set(r.item.productId, cand);
    }
  }
  return [...best.values()]
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) || b.hit.similarity - a.hit.similarity,
    )
    .slice(0, limit)
    .map((c) => c.hit);
}
