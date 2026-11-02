/** Display hints for the review screen. Data stays as is; these only annotate. */

export interface HintAisle {
  key: string;
  n: string;
  items: string[];
}

/** Numbers of OTHER aisles containing the exact item text ("" when none). */
export function alsoIn(item: string, aisles: HintAisle[], skipKey: string): string[] {
  const out: string[] = [];
  for (const a of aisles) {
    if (a.key === skipKey) continue;
    if (a.items.includes(item) && !out.includes(a.n)) out.push(a.n);
  }
  return out;
}
