import type { StoreProduct } from "@quickaisle/schema";
import { normalize } from "./normalize.ts";

/**
 * Common staples → department keywords, in normalized form. Keys must match
 * normalize(term) exactly — plurals, quantities and units are already
 * stripped by normalize ("2 lbs potatoes" → "potatoe"), so they are covered;
 * true misspellings ("cheses") intentionally miss and stay on the AI path.
 * Keywords are tried in order (exact department name first, then a
 * whole-word mention), so Tortilleria wins over Bakery for tortillas and
 * Market over Meat — while "Market Deli" never shadows the "Market"
 * department.
 */
const STAPLE_DEPTS = new Map<string, string[]>([
  // Dairy
  ["egg", ["Dairy"]],
  ["milk", ["Dairy"]],
  ["butter", ["Dairy"]],
  ["cheese", ["Dairy"]],
  ["yogurt", ["Dairy"]],
  ["cream", ["Dairy"]],
  ["sour cream", ["Dairy"]],
  // Frozen
  ["ice cream", ["Frozen"]],
  ["frozen pizza", ["Frozen"]],
  ["frozen vegetable", ["Frozen"]],
  ["frozen food", ["Frozen"]],
  ["ice", ["Frozen"]],
  // Bakery
  ["bread", ["Bakery"]],
  ["bagel", ["Bakery"]],
  ["cake", ["Bakery"]],
  ["donut", ["Bakery"]],
  ["tortilla", ["Tortilleria", "Bakery"]],
  ["fresh tortilla", ["Tortilleria", "Bakery"]],
  // Produce ("tomatoe"/"potatoe" are normalize's singular of -oes plurals)
  ["apple", ["Produce"]],
  ["banana", ["Produce"]],
  ["lettuce", ["Produce"]],
  ["tomato", ["Produce"]],
  ["tomatoe", ["Produce"]],
  ["onion", ["Produce"]],
  ["potato", ["Produce"]],
  ["potatoe", ["Produce"]],
  ["avocado", ["Produce"]],
  ["fruit", ["Produce"]],
  ["vegetable", ["Produce"]],
  // Meat
  ["chicken", ["Market", "Meat"]],
  ["beef", ["Market", "Meat"]],
  ["pork", ["Market", "Meat"]],
  ["ground beef", ["Market", "Meat"]],
  ["steak", ["Market", "Meat"]],
  ["turkey", ["Market", "Meat"]],
  // Seafood
  ["fish", ["Seafood"]],
  ["shrimp", ["Seafood"]],
  ["salmon", ["Seafood"]],
  // Deli
  ["ham", ["Deli"]],
  ["turkey slice", ["Deli"]],
  ["deli meat", ["Deli"]],
  // Beer & Wine
  ["beer", ["Beer & Wine", "Wine"]],
  ["wine", ["Beer & Wine", "Wine"]],
  // Floral / Pharmacy
  ["flower", ["Floral"]],
  ["prescription", ["Pharmacy"]],
]);

/**
 * Last-resort routing for a still-unmatched term: a common staple resolves
 * to its department's product (routes to that department). Returns null
 * when the term isn't a known staple, when no department matches, or — so a
 * direct sale is never overridden — when the catalog already sells the term
 * by name or alias. Pure; works offline.
 */
export function departmentFallback(
  term: string,
  products: StoreProduct[],
): StoreProduct | null {
  const n = normalize(term);
  if (!n) return null;
  for (const p of products) {
    if (normalize(p.name) === n) return null;
    for (const a of p.aliases ?? []) {
      if (normalize(a) === n) return null;
    }
  }
  const keywords = STAPLE_DEPTS.get(n);
  if (!keywords) return null;
  for (const kw of keywords) {
    const normKw = normalize(kw);
    const exact = products.find((p) => normalize(p.name) === normKw);
    if (exact) return exact;
    const mention = products.find((p) => mentionsDepartment(p.name, kw));
    if (mention) return mention;
  }
  return null;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whole-word, case-insensitive mention of a department keyword in a product
 * name — unless negated ("Non-Dairy ..."). "Dairy Case" and "Frozen Foods"
 * mention their keyword; "Non-Dairy Beverages" (hyphen, space, or glued)
 * never counts.
 */
function mentionsDepartment(name: string, keyword: string): boolean {
  const kw = escapeRegExp(keyword.trim());
  if (!kw) return false;
  const hit = new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, "i").exec(name);
  if (!hit) return false;
  const before = name.slice(0, hit.index + hit[1]!.length);
  return !/(^|[^a-z])non[-\s]?$/i.test(before);
}
