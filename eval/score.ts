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
