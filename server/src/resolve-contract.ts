import { z } from "zod";
import { ResolveMatch } from "@quickaisle/schema";

/**
 * POST /resolve contract, shared by the server route and the T3 eval so
 * accuracy tests exercise the real prompt + schema.
 *
 * Kept inside the strict-JSON subset (object/array/string/number/boolean —
 * no unions, records, or optionals) so it works on Meta strict mode and on
 * Baseten via the prompt-embedded JSON Schema. Refinements (.min/.max)
 * are enforced by Zod at validation time.
 */

export const ResolveAnswer = z.object({
  input: z.string(),
  matches: z.array(ResolveMatch).max(5),
  needsClarification: z.boolean(),
  /** "" when needsClarification is false */
  question: z.string(),
  /** candidate catalog names; [] when needsClarification is false */
  options: z.array(z.string()),
});
export type ResolveAnswerData = z.infer<typeof ResolveAnswer>;

export const ResolveSchema = z.object({
  answers: z.array(ResolveAnswer).min(1),
});
export type ResolveData = z.infer<typeof ResolveSchema>;

export interface CatalogEntry {
  id: string;
  name: string;
}

export interface ResolvePromptDef {
  version: string;
  system: string;
  user: (terms: string[], catalog: CatalogEntry[]) => string;
}

function resolveUser(
  terms: string[],
  catalog: CatalogEntry[],
  rules: string,
): string {
  return (
    "Catalog (id | name):\n" +
    catalog.map((c) => `${c.id} | ${c.name}`).join("\n") +
    "\n\nResolve each list term:\n" +
    rules +
    '\nReturn JSON: {"answers": [{"input": <the exact term>, "matches": ' +
    '[{"productId": <id>, "confidence": <0-1>}], "needsClarification": <bool>, ' +
    '"question": <"" or short question>, "options": [<catalog names>]}]}.\n' +
    "\nTerms:\n" +
    terms.map((t) => `- ${t}`).join("\n")
  );
}

export const RESOLVE_PROMPT_V1: ResolvePromptDef = {
  version: "resolve-v1",
  system:
    "You match messy grocery list terms to a store catalog. Answer with one " +
    "entry per input term, in the same order. Use only productIds from the " +
    "catalog below — never invent one. Be conservative: a wrong match is " +
    "worse than asking.",
  // Frozen: v1 text must stay byte-identical so v1/v2 evals compare fairly.
  user: (terms: string[], catalog: CatalogEntry[]): string =>
    resolveUser(
      terms,
      catalog,
      '- Misspelled ("cerial"), abbreviated ("mayo"), brand ("tide" is laundry ' +
        'detergent), or translated ("leche" is milk) terms → the single best ' +
        "match, confidence 0.85–1.\n" +
        '- Meals and occasions ("taco night") → one match per staple ingredient, ' +
        "confidence 0.7+.\n" +
        '- Bare staples prefer the fresh, everyday variant ("milk" is fresh Milk, ' +
        "not canned/powdered).\n" +
        '- Vague or multi-product terms ("cheese", "chicken", "bread") → ' +
        "needsClarification true, a short question, and options listing the " +
        "candidate catalog names.\n" +
        "- Anything not sold in this store, or garbage text → no matches and " +
        "needsClarification false. Do NOT stretch to an unrelated category.\n",
    ),
};

export const RESOLVE_PROMPT_V2: ResolvePromptDef = {
  version: "resolve-v2",
  system:
    "You match messy grocery list terms to a store catalog. Answer with one " +
    "entry per input term, in the same order. Use only productIds from the " +
    "catalog below — never invent one. Be conservative: a wrong match is " +
    "worse than asking. The Pharmacy is the prescription counter only — " +
    "over-the-counter medicine belongs to its aisle category, never to Pharmacy.",
  user: (terms: string[], catalog: CatalogEntry[]): string =>
    resolveUser(
      terms,
      catalog,
      '- Misspelled ("cerial"), abbreviated ("mayo"), or brand ("tide" is laundry ' +
        "detergent) terms → the single best match, confidence 0.85–1.\n" +
        '- Translated terms → translate common Spanish grocery words to English ' +
        'first ("leche" is milk, and likewise for beans, eggs, cheese, …), then ' +
        "match the English term.\n" +
        '- Meals and occasions ("taco night") → one match per staple ingredient, ' +
        "confidence 0.7+, including the fresh staples from their departments " +
        "(meat, vegetables, milk/eggs) alongside packaged goods.\n" +
        '- Bare staples prefer the fresh, everyday variant ("milk" is fresh Milk, ' +
        "not canned/powdered).\n" +
        "- Over-the-counter medicine → the matching aisle category (pain relief, " +
        "cold/cough remedies, allergy, first aid) — never Pharmacy. If two aisle " +
        "categories both fit, ask with both as options.\n" +
        '- Vague or multi-product terms ("cheese", "chicken", "bread") → if one ' +
        "or two catalog categories clearly fit, return them directly; ask only " +
        "when genuinely ambiguous, and then always list the candidate catalog " +
        "names as options.\n" +
        "- Anything not sold in this store, or garbage text → no matches and " +
        "needsClarification false. Do NOT stretch to an unrelated category.\n",
    ),
};

/**
 * Current prompt: used by POST /resolve and by T3 unless overridden.
 * V1 won: v2 regressed top-1 on both providers (§10). V2 stays in this
 * file as a parked experiment.
 */
export const RESOLVE_PROMPT: ResolvePromptDef = RESOLVE_PROMPT_V1;
