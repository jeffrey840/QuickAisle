/** Pure shop-mode state. Stop order never changes; nothing re-routes. */

export interface ShopStop {
  /** big display line, e.g. "Aisle 7 — Pickles" */
  label: string;
  /** short name for the end summary, e.g. "pickles" */
  name: string;
}

export interface ShopState {
  stops: ShopStop[];
  /** index of the current stop; >= stops.length means done */
  index: number;
  got: boolean[];
  skipped: boolean[];
}

export function startShop(stops: ShopStop[]): ShopState {
  return {
    stops,
    index: 0,
    got: stops.map(() => false),
    skipped: stops.map(() => false),
  };
}

export function isDone(s: ShopState): boolean {
  return s.index >= s.stops.length;
}

export interface ShopCurrent {
  stop: ShopStop;
  /** 1-based position for "3 of 8" */
  position: number;
  total: number;
}

export function current(s: ShopState): ShopCurrent | null {
  const stop = s.stops[s.index];
  if (!stop) return null;
  return { stop, position: s.index + 1, total: s.stops.length };
}

export function markGot(s: ShopState): ShopState {
  if (isDone(s)) return s;
  const got = [...s.got];
  got[s.index] = true;
  return { ...s, got, index: s.index + 1 };
}

export function markSkipped(s: ShopState): ShopState {
  if (isDone(s)) return s;
  const skipped = [...s.skipped];
  skipped[s.index] = true;
  return { ...s, skipped, index: s.index + 1 };
}

export interface ShopSummary {
  got: number;
  skipped: number;
  skippedNames: string[];
}

export function summarize(s: ShopState): ShopSummary {
  const skippedNames = s.stops
    .filter((_, i) => s.skipped[i])
    .map((stop) => stop.name);
  return {
    got: s.got.filter(Boolean).length,
    skipped: skippedNames.length,
    skippedNames,
  };
}
