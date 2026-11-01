import type { StoreProduct } from "@quickaisle/schema";
import { FUZZY_ACCEPT, FUZZY_GRAY, buildFuzzyIndex, fuzzyMatch } from "./fuzzy.ts";
import type { FuzzyHit } from "./fuzzy.ts";
import { normalize } from "./normalize.ts";

export { FUZZY_ACCEPT, FUZZY_GRAY, buildFuzzyIndex, fuzzyMatch, normalize };
export type { FuzzyHit };

export interface MatchResult {
  productId: string;
  via: "exact" | "alias";
}

/** Day 1: exact match on normalized name/aliases only. Fuzzy + AI arrive Day 2. */
export function exactMatch(term: string, products: StoreProduct[]): MatchResult | null {
  const n = normalize(term);
  if (!n) return null;
  for (const p of products) {
    if (normalize(p.name) === n) return { productId: p.id, via: "exact" };
  }
  for (const p of products) {
    for (const a of p.aliases) {
      if (normalize(a) === n) return { productId: p.id, via: "alias" };
    }
  }
  return null;
}

export interface ListResolve {
  matched: Array<{ term: string; productId: string; via: string }>;
  unmatched: string[];
}

export function resolveListExact(terms: string[], products: StoreProduct[]): ListResolve {
  const matched: ListResolve["matched"] = [];
  const unmatched: string[] = [];
  for (const t of terms) {
    const m = exactMatch(t, products);
    if (m) matched.push({ term: t, productId: m.productId, via: m.via });
    else unmatched.push(t);
  }
  return matched.length || unmatched.length ? { matched, unmatched } : { matched, unmatched };
}

/** A term→product mapping learned from an accepted AI answer. */
export interface LearnedAlias {
  productId: string;
  confidence: number;
  ts: number;
}

/**
 * Alias storage. Device-only for now (AsyncStorage implementation in the
 * app); a future shared store should promote an alias only after ≥3
 * different devices learn the same mapping (see HANDOFF_PLAN.md §6).
 */
export interface AliasStore {
  get(storeId: string, term: string): Promise<LearnedAlias | null>;
  save(storeId: string, term: string, productId: string, confidence: number): Promise<void>;
}

export interface LocalMatch {
  term: string;
  productId: string;
  via: "exact" | "alias" | "fuzzy";
}

export interface NeedAi {
  term: string;
  /** gray-zone fuzzy candidates (similarity ≥ FUZZY_GRAY), best first */
  suggestions: FuzzyHit[];
}

export interface LocalResolve {
  matched: LocalMatch[];
  needAi: NeedAi[];
}

/**
 * Local pipeline (plan §6): exact → catalog alias → learned alias →
 * fuzzy-accept (≥ FUZZY_ACCEPT) → AI. Learned aliases whose productId is
 * gone from the catalog are ignored. Terms that normalize to empty are
 * skipped.
 */
export async function resolveLocal(
  terms: string[],
  products: StoreProduct[],
  opts?: { storeId?: string; aliases?: AliasStore },
): Promise<LocalResolve> {
  const ids = new Set(products.map((p) => p.id));
  const fuse = buildFuzzyIndex(products);
  const matched: LocalMatch[] = [];
  const needAi: NeedAi[] = [];
  for (const term of terms) {
    if (!normalize(term)) continue;
    const ex = exactMatch(term, products);
    if (ex) {
      matched.push({ term, productId: ex.productId, via: ex.via });
      continue;
    }
    if (opts?.aliases && opts.storeId) {
      const learned = await opts.aliases.get(opts.storeId, normalize(term));
      if (learned && ids.has(learned.productId)) {
        matched.push({ term, productId: learned.productId, via: "alias" });
        continue;
      }
    }
    const hits = fuzzyMatch(term, fuse, 3);
    if (hits.length > 0 && hits[0]!.similarity >= FUZZY_ACCEPT) {
      matched.push({ term, productId: hits[0]!.productId, via: "fuzzy" });
      continue;
    }
    needAi.push({
      term,
      suggestions: hits.filter((h) => h.similarity >= FUZZY_GRAY),
    });
  }
  return { matched, needAi };
}
