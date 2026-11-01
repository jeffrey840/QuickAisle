/**
 * Pure scoring functions for the §10 provider accuracy tests.
 * No network, no providers — safe to unit test with synthetic answers.
 */

export const normName = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]/g, "");
export const normAisle = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------- T1: directory reading ----------

export interface T1GoldItem {
  name: string;
  aisle: string;
}
export interface T1Mismatch {
  name: string;
  expectedAisle: string;
  /** model answer, or null when the row is missing entirely */
  gotAisle: string | null;
}

export interface T1Score {
  recall: number;
  found: number;
  total: number;
  aisleAccuracy: number;
  aisleCorrect: number;
  /** rows with name found AND aisle right, over total */
  rowAccuracy: number;
  rowCorrect: number;
  extras: string[];
  missing: string[];
  mismatches: T1Mismatch[];
  /** known map-vs-directory conflicts, reported apart — never failures */
  conflicts: T1Mismatch[];
}

/**
 * Score directory extraction. `conflictNames` (gold.known_conflicts) are
 * excluded from every denominator and reported in `conflicts` instead.
 */
export function scoreT1(
  gold: T1GoldItem[],
  answer: Array<{ name: string; aisle: string }>,
  conflictNames: string[] = [],
): T1Score {
  const conflictKeys = new Set(conflictNames.map(normName));
  const scored = gold.filter((g) => !conflictKeys.has(normName(g.name)));
  const conflicted = gold.filter((g) => conflictKeys.has(normName(g.name)));
  const goldByName = new Map(gold.map((g) => [normName(g.name), g]));
  const seen = new Map<string, string>(); // norm name -> answered aisle
  const extras: string[] = [];
  for (const row of answer) {
    const key = normName(row.name);
    if (seen.has(key)) continue;
    seen.set(key, row.aisle);
    if (!goldByName.has(key)) extras.push(row.name);
  }
  let aisleCorrect = 0;
  const mismatches: T1Mismatch[] = [];
  const missing: string[] = [];
  for (const g of scored) {
    const got = seen.get(normName(g.name));
    if (got === undefined) {
      missing.push(g.name);
      mismatches.push({ name: g.name, expectedAisle: g.aisle, gotAisle: null });
    } else if (normAisle(got) === normAisle(g.aisle)) {
      aisleCorrect++;
    } else {
      mismatches.push({ name: g.name, expectedAisle: g.aisle, gotAisle: got });
    }
  }
  const found = scored.length - missing.length;
  const conflicts: T1Mismatch[] = conflicted.map((g) => ({
    name: g.name,
    expectedAisle: g.aisle,
    gotAisle: seen.get(normName(g.name)) ?? null,
  }));
  return {
    recall: scored.length ? found / scored.length : 0,
    found,
    total: scored.length,
    aisleAccuracy: found ? aisleCorrect / found : 0,
    aisleCorrect,
    rowAccuracy: scored.length ? aisleCorrect / scored.length : 0,
    rowCorrect: aisleCorrect,
    extras,
    missing,
    mismatches,
    conflicts,
  };
}

// ---------- T2: map reading ----------

export const AISLE_X_TRUTH: Record<number, number> = {
  1: 327, 2: 380, 3: 427, 4: 476, 5: 521, 6: 572, 7: 622, 8: 671,
  9: 723, 10: 773, 11: 815, 12: 865, 13: 910, 14: 962, 15: 1015,
  16: 1097, 17: 1172,
};
export const DEPT_TRUTH: Array<{ name: string; xy: [number, number] }> = [
  { name: "Produce", xy: [250, 470] },
  { name: "Bakery", xy: [365, 110] },
  { name: "Market Deli", xy: [580, 210] },
  { name: "Sushi", xy: [778, 212] },
  { name: "Seafood", xy: [775, 140] },
  { name: "Market", xy: [965, 175] },
  { name: "Milk", xy: [1155, 95] },
  { name: "Eggs", xy: [1182, 180] },
  { name: "Dairy", xy: [1182, 330] },
  { name: "Frozen Foods", xy: [1097, 445] },
  { name: "Deli", xy: [265, 875] },
  { name: "Pharmacy", xy: [1140, 840] },
  { name: "Floral", xy: [395, 750] },
  { name: "Checkstands", xy: [660, 745] },
];
export const ENTRANCE_TRUTH: Array<[number, number]> = [
  [387, 925],
  [598, 930],
];

export interface T2LayoutAnswer {
  aisles: Array<{ n: number; x: number }>;
  departments: Array<{ name: string; xy: [number, number] }>;
  entrances: Array<{ xy: [number, number] }>;
}
export interface T2Score {
  aisleCount: number;
  aisleCountOk: boolean;
  orderOk: boolean;
  meanXErrorPx: number;
  xErrors: number[];
  deptsFound: number;
  deptsTotal: number;
  deptsMissing: string[];
  entrancesFound: number;
}

const dist = (a: [number, number], b: [number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

export function scoreT2(ans: T2LayoutAnswer): T2Score {
  const aisles = ans.aisles.filter((a) => a.n >= 1 && a.n <= 17);
  const byN = new Map(aisles.map((a) => [a.n, a]));
  const ordered = [...byN.entries()].sort((p, q) => p[0] - q[0]);
  let orderOk = ordered.length > 1;
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]![1].x <= ordered[i - 1]![1].x) {
      orderOk = false;
      break;
    }
  }
  const xErrors = ordered.map(([n, a]) => Math.abs(a.x - AISLE_X_TRUTH[n]!));
  const meanXErrorPx = xErrors.length
    ? xErrors.reduce((s, e) => s + e, 0) / xErrors.length
    : Infinity;

  const deptsMissing: string[] = [];
  let deptsFound = 0;
  for (const t of DEPT_TRUTH) {
    const tn = normName(t.name);
    const hit = ans.departments.some((d) => {
      const dn = normName(d.name);
      return (dn.includes(tn) || tn.includes(dn)) && dist(d.xy, t.xy) <= 150;
    });
    if (hit) deptsFound++;
    else deptsMissing.push(t.name);
  }

  let entrancesFound = 0;
  const used = new Set<number>();
  for (const t of ENTRANCE_TRUTH) {
    const i = ans.entrances.findIndex(
      (e, k) => !used.has(k) && dist(e.xy, t) <= 100,
    );
    if (i >= 0) {
      used.add(i);
      entrancesFound++;
    }
  }

  return {
    aisleCount: aisles.length,
    aisleCountOk: aisles.length === 17,
    orderOk,
    meanXErrorPx,
    xErrors,
    deptsFound,
    deptsTotal: DEPT_TRUTH.length,
    deptsMissing,
    entrancesFound,
  };
}

// ---------- T3: list understanding ----------

export type T3Expect =
  | { any_of: string[] }
  | { clarify: true; options_any_of: string[] }
  | { expand_includes: string[][] }
  | { none: true };

export interface T3Answer {
  /** top matches as product NAMES (runner maps provider ids → names) */
  topNames: string[];
  needsClarification: boolean;
  /** productIds the provider returned that are not in the catalog */
  invented: string[];
}

export interface T3CaseScore {
  correct: boolean;
  invented: number;
  askedWhenShould: boolean | null; // null when n/a
  askedWhenShouldNot: boolean;
}

export function scoreT3Case(expect: T3Expect, ans: T3Answer): T3CaseScore {
  if ("none" in expect) {
    return {
      correct: ans.topNames.length === 0,
      invented: ans.invented.length,
      askedWhenShould: null,
      askedWhenShouldNot: ans.needsClarification,
    };
  }
  if ("clarify" in expect) {
    return {
      correct: ans.needsClarification,
      invented: ans.invented.length,
      askedWhenShould: ans.needsClarification,
      askedWhenShouldNot: false,
    };
  }
  if ("expand_includes" in expect) {
    const groups = expect.expand_includes.map((g) => g.map(normName));
    const got = ans.topNames.map(normName);
    const correct = groups.every((g) => g.some((name) => got.includes(name)));
    return {
      correct,
      invented: ans.invented.length,
      askedWhenShould: null,
      askedWhenShouldNot: ans.needsClarification,
    };
  }
  const want = expect.any_of.map(normName);
  const top = ans.topNames[0] ? normName(ans.topNames[0]) : "";
  return {
    correct: want.includes(top),
    invented: ans.invented.length,
    askedWhenShould: null,
    askedWhenShouldNot: ans.needsClarification,
  };
}

// ---------- T4: list-photo extraction ----------

export interface T4ListGold {
  items: string[];
  mustNotReturn: string[];
  notes: string[];
}

export interface T4GoldFile {
  source: string;
  [image: string]: T4ListGold | string;
}

export function t4Lists(gold: T4GoldFile): Array<{ image: string; gold: T4ListGold }> {
  return Object.entries(gold)
    .filter(([k]) => k !== "source")
    .map(([image, g]) => ({ image, gold: g as T4ListGold }));
}

/**
 * T4 normalization: lowercase, trim, strip leading "-" / "|", strip
 * trailing "." / ",", collapse spaces. Matching after this is exact —
 * like T3 (scoreT3Case), there is no fuzzy tolerance.
 */
export function normT4Item(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^[-|]+\s*/, "")
    .replace(/[.,]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripNotePhrases(
  nr: string,
  notes: string[],
): { cleaned: string; leaked: boolean } {
  let cleaned = nr;
  let leaked = false;
  for (const n of notes) {
    const p = normT4Item(n);
    if (p && cleaned.includes(p)) {
      leaked = true;
      cleaned = cleaned.replace(p, " ");
    }
  }
  if (leaked) {
    cleaned = cleaned
      .replace(/[<>()-]+/g, " ")
      .replace(/[.,]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return { cleaned, leaked };
}

function isMustNotHit(nr: string, entry: string): boolean {
  const ne = normT4Item(entry);
  if (!ne) return false;
  return nr === ne || nr.startsWith(`${ne} `) || nr.startsWith(`${ne} (`);
}

/**
 * Lenient hit: T3's normName (strip all non-alphanumerics) equal, or one
 * side contains the other. Multiplication signs fold to "x" first, so
 * transcription wobble ("Cheerios ×2" vs "Cheerios x2") matches while
 * real misses ("2 dozen eggs" vs "2 doz eggs") don't. Empty on either
 * side never matches.
 */
export function t4LenientHit(returned: string, goldItem: string): boolean {
  const prep = (s: string): string => normName(s.replace(/[×✕✖]/g, "x"));
  const a = prep(returned);
  const b = prep(goldItem);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export interface T4ListScore {
  image: string;
  matched: number;
  total: number;
  recall: number;
  /** gold items with a lenient hit (strict stays the headline) */
  lenientMatched: number;
  /** returned but matching nothing (mustNot hits are NOT included here) */
  falseItems: string[];
  /** the headline safety number: crossed-out items, headings, decoys */
  mustNotHits: string[];
  /** returned strings that smuggled a note phrase in with an item */
  noteLeaks: string[];
  missing: string[];
}

export interface T4ReturnedItem {
  text: string;
  quantity?: string;
}

/**
 * Strict-match candidates for one returned item: the text plus both
 * quantity orders. The combos are skipped when quantity is empty or
 * already inside the text, so a model that splits "2 doz" / "eggs" and
 * a model that keeps "2 doz eggs" in text score the same.
 */
function t4Candidates(item: T4ReturnedItem): string[] {
  const out = [item.text];
  const q = (item.quantity ?? "").trim();
  if (q && !normT4Item(item.text).includes(normT4Item(q))) {
    out.push(`${item.quantity} ${item.text}`, `${item.text} ${item.quantity}`);
  }
  return [...new Set(out)];
}

/**
 * Scores extraction only, not product matching: raw spellings and
 * quantities count as long as the text matches the gold.
 */
export function scoreT4List(
  image: string,
  gold: T4ListGold,
  returned: T4ReturnedItem[],
): T4ListScore {
  const want = new Map(gold.items.map((g) => [normT4Item(g), g]));
  const used = new Set<string>();
  const falseItems: string[] = [];
  const mustNotHits: string[] = [];
  const noteLeaks: string[] = [];
  const cleanReturns: string[] = [];
  for (const r of returned) {
    const rawCands = t4Candidates(r);
    const cands = [...new Set(rawCands.map(normT4Item).filter(Boolean))];
    if (cands.length === 0) continue;
    if (cands.some((nr) => gold.mustNotReturn.some((e) => isMustNotHit(nr, e)))) {
      mustNotHits.push(r.text);
      continue;
    }
    cleanReturns.push(...rawCands);
    const strictHit = cands.find((nr) => want.has(nr) && !used.has(nr));
    if (strictHit) {
      used.add(strictHit);
      continue;
    }
    let leaked = false;
    let cleanHit: string | null = null;
    for (const nr of cands) {
      const stripped = stripNotePhrases(nr, gold.notes);
      if (stripped.leaked) leaked = true;
      if (stripped.leaked && want.has(stripped.cleaned) && !used.has(stripped.cleaned)) {
        cleanHit = stripped.cleaned;
        break;
      }
    }
    if (leaked) noteLeaks.push(r.text);
    if (cleanHit) {
      used.add(cleanHit);
      continue;
    }
    falseItems.push(r.text);
  }
  const missing = [...want.entries()]
    .filter(([n]) => !used.has(n))
    .map(([, g]) => g);
  // Lenient recall runs over non-mustNot returns only, so a safety
  // violation (e.g. "ice cream" for list-10) never credits "ice".
  const lenientMatched = gold.items.filter((g) =>
    cleanReturns.some((r) => t4LenientHit(r, g)),
  ).length;
  return {
    image,
    matched: used.size,
    total: gold.items.length,
    recall: gold.items.length ? used.size / gold.items.length : 0,
    lenientMatched,
    falseItems,
    mustNotHits,
    noteLeaks,
    missing,
  };
}

export interface T4ListResult {
  image: string;
  /** zeroed score when timeout/error — a failed list, never skipped */
  score: T4ListScore;
  ms: number;
  timeout: boolean;
  error?: string;
}

export interface T4RunScore {
  lists: number;
  failed: number;
  timeouts: number;
  recall: number;
  lenientRecall: number;
  falseItems: number;
  mustNotHits: number;
  noteLeaks: number;
  p50: number;
  max: number;
}

/** Micro-recall over all lists (timeouts score 0, not skipped) + latency. */
export function scoreT4Run(results: T4ListResult[]): T4RunScore {
  let matched = 0;
  let lenient = 0;
  let total = 0;
  let falseItems = 0;
  let mustNotHits = 0;
  let noteLeaks = 0;
  let failed = 0;
  let timeouts = 0;
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  for (const r of results) {
    matched += r.score.matched;
    lenient += r.score.lenientMatched;
    total += r.score.total;
    falseItems += r.score.falseItems.length;
    mustNotHits += r.score.mustNotHits.length;
    noteLeaks += r.score.noteLeaks.length;
    if (r.timeout || r.error) failed++;
    if (r.timeout) timeouts++;
  }
  return {
    lists: results.length,
    failed,
    timeouts,
    recall: total ? matched / total : 0,
    lenientRecall: total ? lenient / total : 0,
    falseItems,
    mustNotHits,
    noteLeaks,
    p50: lat.length ? lat[Math.min(lat.length - 1, Math.floor(0.5 * lat.length))]! : 0,
    max: lat.length ? lat[lat.length - 1]! : 0,
  };
}
