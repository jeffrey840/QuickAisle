import type { IngestData } from "./ingest-contract.ts";

/**
 * Majority merge for parallel /ingest runs (Oct 31 had 0% run agreement,
 * so the merge is the point). Pure functions — no network, no Zod.
 */

export type Box4 = [number, number, number, number];

export interface MergedAisle {
  n: string;
  orientation: "vertical" | "horizontal";
  box: Box4;
  items: string[];
  /** runs that reported this aisle number */
  agreement: number;
  /** which merged view the items came from (set by combineIngestViews) */
  itemsView?: ItemsView;
}

/** per-aisle item source in a two-view /ingest response */
export type ItemsView = "original" | "rotated";

export interface MergedDepartment {
  name: string;
  box: Box4;
  agreement: number;
}

export interface MergedEntrance {
  box: Box4;
  kind: "entrance" | "exit" | "both";
  agreement: number;
}

export interface MergedIngest {
  runsOk: number;
  lowConfidence: boolean;
  aisles: MergedAisle[];
  departments: MergedDepartment[];
  entrances: MergedEntrance[];
  notes: string[];
}

/** entrance centres within this grid distance cluster together */
export const CLUSTER_DIST = 100;

export const MAX_AISLES = 60;
export const MAX_ITEMS_PER_AISLE = 40;
export const MAX_ITEMS_TOTAL = 800;
export const MAX_STRING = 60;

export function normIngestItem(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function medianRounded(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return Math.round(m);
}

function medianBox(boxes: number[][]): Box4 {
  const col = (i: number): number => medianRounded(boxes.map((b) => b[i] ?? 0));
  return [col(0), col(1), col(2), col(3)];
}

function roundBox(box: number[]): Box4 {
  return [
    Math.round(box[0] ?? 0),
    Math.round(box[1] ?? 0),
    Math.round(box[2] ?? 0),
    Math.round(box[3] ?? 0),
  ];
}

function centre(box: number[]): [number, number] {
  return [((box[0] ?? 0) + (box[2] ?? 0)) / 2, ((box[1] ?? 0) + (box[3] ?? 0)) / 2];
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

interface AisleVotes {
  key: string;
  runs: Set<number>;
  orientations: Array<{ run: number; o: "vertical" | "horizontal" }>;
  boxes: number[][];
  order: number;
}

export function mergeIngestRuns(runs: IngestData[]): MergedIngest {
  if (runs.length === 0) {
    return { runsOk: 0, lowConfidence: true, aisles: [], departments: [], entrances: [], notes: [] };
  }
  if (runs.length === 1) {
    const only = runs[0]!;
    return {
      runsOk: 1,
      lowConfidence: true,
      aisles: only.aisles.map((a) => ({
        n: a.n.trim(),
        orientation: a.orientation,
        box: roundBox(a.box),
        items: [...new Set(a.items.map(normIngestItem).filter(Boolean))],
        agreement: 1,
      })),
      departments: only.departments.map((d) => ({
        name: d.name.trim(),
        box: roundBox(d.box),
        agreement: 1,
      })),
      entrances: only.entrances.map((e) => ({
        box: roundBox(e.box),
        kind: e.kind,
        agreement: 1,
      })),
      notes: [...new Set(only.notes.map((n) => n.trim()).filter(Boolean))],
    };
  }

  // ---- aisles: match by n, keep if seen in ≥2 runs ----
  const groups = new Map<string, AisleVotes>();
  runs.forEach((run, ri) => {
    const seenThisRun = new Set<string>();
    for (const a of run.aisles) {
      const key = a.n.trim();
      if (!key || seenThisRun.has(key)) continue;
      seenThisRun.add(key);
      let g = groups.get(key);
      if (!g) {
        g = { key, runs: new Set(), orientations: [], boxes: [], order: groups.size };
        groups.set(key, g);
      }
      g.runs.add(ri);
      g.orientations.push({ run: ri, o: a.orientation });
      g.boxes.push(a.box);
    }
  });
  const kept = [...groups.values()]
    .filter((g) => g.runs.size >= 2)
    .sort((a, b) => a.order - b.order);

  // ---- items: normalized, kept if seen in ≥2 runs, placed by aisle votes ----
  const itemRuns = new Map<string, Set<number>>();
  const itemAisleVotes = new Map<string, Map<string, number>>();
  const itemFirstSeen = new Map<string, number>();
  let seenCounter = 0;
  runs.forEach((run, ri) => {
    for (const a of run.aisles) {
      const key = a.n.trim();
      if (!key) continue;
      for (const raw of new Set(a.items.map(normIngestItem).filter(Boolean))) {
        if (!itemRuns.has(raw)) {
          itemRuns.set(raw, new Set());
          itemAisleVotes.set(raw, new Map());
          itemFirstSeen.set(raw, seenCounter++);
        }
        itemRuns.get(raw)!.add(ri);
        const votes = itemAisleVotes.get(raw)!;
        votes.set(key, (votes.get(key) ?? 0) + 1);
      }
    }
  });
  const keptKeys = new Set(kept.map((g) => g.key));
  const aisleItems = new Map<string, string[]>();
  for (const g of kept) aisleItems.set(g.key, []);
  for (const [item, runSet] of itemRuns) {
    if (runSet.size < 2) continue;
    const votes = itemAisleVotes.get(item)!;
    let best = 0;
    for (const [aisle, n] of votes) {
      if (keptKeys.has(aisle) && n > best) best = n;
    }
    if (best === 0) continue;
    for (const [aisle, n] of votes) {
      if (keptKeys.has(aisle) && n === best) aisleItems.get(aisle)!.push(item);
    }
  }
  for (const list of aisleItems.values()) {
    list.sort((a, b) => itemFirstSeen.get(a)! - itemFirstSeen.get(b)!);
  }

  const aisles: MergedAisle[] = kept.map((g) => {
    const v = g.orientations.filter((o) => o.o === "vertical").length;
    const h = g.orientations.length - v;
    const orientation =
      v === h ? g.orientations[0]!.o : v > h ? "vertical" : "horizontal";
    return {
      n: g.key,
      orientation,
      box: medianBox(g.boxes),
      items: aisleItems.get(g.key)!,
      agreement: g.runs.size,
    };
  });

  // ---- departments: group by normalized name, keep if ≥2 runs ----
  const deptGroups = new Map<string, { name: string; runs: Set<number>; boxes: number[][]; order: number }>();
  runs.forEach((run, ri) => {
    const seenThisRun = new Set<string>();
    for (const d of run.departments) {
      const key = normIngestItem(d.name);
      if (!key || seenThisRun.has(key)) continue;
      seenThisRun.add(key);
      let g = deptGroups.get(key);
      if (!g) {
        g = { name: d.name.trim(), runs: new Set(), boxes: [], order: deptGroups.size };
        deptGroups.set(key, g);
      }
      g.runs.add(ri);
      g.boxes.push(d.box);
    }
  });
  const departments: MergedDepartment[] = [...deptGroups.values()]
    .filter((g) => g.runs.size >= 2)
    .sort((a, b) => a.order - b.order)
    .map((g) => ({ name: g.name, box: medianBox(g.boxes), agreement: g.runs.size }));

  // ---- entrances: cluster by box centre, keep clusters with ≥2 runs ----
  interface Cluster {
    centre: [number, number];
    runs: Set<number>;
    boxes: number[][];
    kinds: Array<{ run: number; k: "entrance" | "exit" | "both" }>;
  }
  const clusters: Cluster[] = [];
  runs.forEach((run, ri) => {
    for (const e of run.entrances) {
      const c = centre(e.box);
      const hit = clusters.find((cl) => dist(cl.centre, c) <= CLUSTER_DIST);
      if (hit) {
        hit.runs.add(ri);
        hit.boxes.push(e.box);
        if (!hit.kinds.some((k) => k.run === ri)) hit.kinds.push({ run: ri, k: e.kind });
      } else {
        clusters.push({
          centre: c,
          runs: new Set([ri]),
          boxes: [e.box],
          kinds: [{ run: ri, k: e.kind }],
        });
      }
    }
  });
  const entrances: MergedEntrance[] = clusters
    .filter((cl) => cl.runs.size >= 2)
    .map((cl) => {
      const counts = new Map<string, number>();
      for (const k of cl.kinds) counts.set(k.k, (counts.get(k.k) ?? 0) + 1);
      let kind = cl.kinds[0]!.k;
      let best = -1;
      for (const k of cl.kinds) {
        const n = counts.get(k.k)!;
        if (n > best) {
          best = n;
          kind = k.k;
        }
      }
      return { box: medianBox(cl.boxes), kind, agreement: cl.runs.size };
    });

  // ---- notes: union, deduped ----
  const notes = [
    ...new Set(
      runs.flatMap((r) => r.notes.map((n) => n.trim()).filter(Boolean)),
    ),
  ];

  return { runsOk: runs.length, lowConfidence: false, aisles, departments, entrances, notes };
}

/** appended when the rotated side yields zero runs (still a 200) */
export const ROTATED_FALLBACK_NOTE = "rotated view unreadable — items from original only";

/**
 * Two-view combine (C4): geometry, orientation, departments, entrances and
 * notes come from the ORIGINAL merge; items come from the ROTATED merge for
 * aisles the original calls vertical (sideways labels read better rotated
 * 90° clockwise), matched by aisle number n. Horizontal aisles, and vertical
 * aisles missing from the rotated merge, keep original items. A null/empty
 * rotated side returns the original with itemsView="original" everywhere
 * plus ROTATED_FALLBACK_NOTE. Pure — returns a new object.
 */
export function combineIngestViews(
  orig: MergedIngest,
  rot: MergedIngest | null,
): MergedIngest {
  const tagOriginal = (): MergedIngest => ({
    runsOk: orig.runsOk,
    lowConfidence: orig.lowConfidence,
    aisles: orig.aisles.map((a) => ({ ...a, items: [...a.items], itemsView: "original" as ItemsView })),
    departments: orig.departments.map((d) => ({ ...d })),
    entrances: orig.entrances.map((e) => ({ ...e })),
    notes: [...orig.notes, ROTATED_FALLBACK_NOTE],
  });
  if (!rot || rot.runsOk === 0) return tagOriginal();
  const rotItems = new Map<string, string[]>();
  for (const a of rot.aisles) {
    if (!rotItems.has(a.n)) rotItems.set(a.n, a.items);
  }
  return {
    runsOk: orig.runsOk + rot.runsOk,
    lowConfidence: orig.lowConfidence || rot.lowConfidence,
    aisles: orig.aisles.map((a) => {
      const items = a.orientation === "vertical" ? rotItems.get(a.n) : undefined;
      return items === undefined
        ? { ...a, items: [...a.items], itemsView: "original" as ItemsView }
        : { ...a, items: [...items], itemsView: "rotated" as ItemsView };
    }),
    departments: orig.departments.map((d) => ({ ...d })),
    entrances: orig.entrances.map((e) => ({ ...e })),
    notes: [...orig.notes],
  };
}

/**
 * Output caps: ≤60 aisles, ≤40 items per aisle, ≤800 items total,
 * every string ≤60 chars. Pure — returns a new object.
 */
export function capMergedIngest(m: MergedIngest): MergedIngest {
  const cut = (s: string): string => s.slice(0, MAX_STRING);
  let total = 0;
  const aisles = m.aisles.slice(0, MAX_AISLES).map((a) => {
    const room = Math.max(0, Math.min(MAX_ITEMS_PER_AISLE, MAX_ITEMS_TOTAL - total));
    const items = a.items.slice(0, room).map(cut);
    total += items.length;
    return { ...a, n: cut(a.n), items };
  });
  return {
    ...m,
    aisles,
    departments: m.departments.map((d) => ({ ...d, name: cut(d.name) })),
    notes: m.notes.map(cut),
  };
}
