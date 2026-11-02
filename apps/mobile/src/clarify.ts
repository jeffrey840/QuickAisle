import type { StoreProduct } from "@quickaisle/schema";
import { normalize, type FuzzyHit } from "@quickaisle/matching";

export interface ClarifyOption {
  productId: string;
  name: string;
}

export interface ClarifyCard {
  kind: "ai" | "suggest";
  term: string;
  question: string;
  /** AI: catalog-mapped options, max 4. Suggest: exactly 1. */
  options: ClarifyOption[];
  /** suggest cards carry the fuzzy similarity for alias learning */
  similarity?: number;
}

export interface AiClarifyAnswer {
  question: string;
  options: string[];
}

const MAX_OPTIONS = 4;

/** Map option names to catalog products; drop anything unmappable. */
export function mapOptionsToProducts(
  options: string[],
  products: StoreProduct[],
): ClarifyOption[] {
  const byName = new Map(products.map((p) => [normalize(p.name), p]));
  const out: ClarifyOption[] = [];
  for (const o of options) {
    const p = byName.get(normalize(o));
    if (p && !out.some((x) => x.productId === p.id)) {
      out.push({ productId: p.id, name: p.name });
    }
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

/**
 * One card for a term, or null when there's nothing to ask. AI clarify
 * wins; when its options map to nothing, fall back to the fuzzy
 * suggestion; otherwise the term stays unmatched.
 */
export function cardForTerm(
  term: string,
  ai: AiClarifyAnswer | undefined,
  suggestions: FuzzyHit[],
  products: StoreProduct[],
): ClarifyCard | null {
  if (ai) {
    const options = mapOptionsToProducts(ai.options, products);
    if (options.length > 0) {
      return { kind: "ai", term, question: ai.question || "Which one did you mean?", options };
    }
  }
  const top = suggestions[0];
  if (top) {
    return {
      kind: "suggest",
      term,
      question: `Did you mean ${top.name}?`,
      options: [{ productId: top.productId, name: top.name }],
      similarity: top.similarity,
    };
  }
  return null;
}

/** Append a picked product to the matched ids (no dupes) for re-planning. */
export function mergePick(matchedIds: string[], productId: string): string[] {
  return matchedIds.includes(productId) ? matchedIds : [...matchedIds, productId];
}
