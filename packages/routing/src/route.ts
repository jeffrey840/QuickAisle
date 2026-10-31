import type { StoreDoc } from "@quickaisle/schema";
import { StoreGraph } from "./graph.ts";

export interface RouteStop {
  productId: string;
  name: string;
  aisleLabel?: string;
  locationId: string;
  /** map-image pixel coords of the stop marker */
  xy: [number, number];
  side: string;
  instruction: string;
  /** pharmacy drop-off vs pick-up (undefined for normal stops) */
  visit?: "dropoff" | "pickup";
}

export interface RouteResult {
  entranceId: string;
  exitId: string;
  stops: RouteStop[];
  /** full walking path in map-image pixels */
  polyline: [number, number][];
  distancePx: number;
  typedOrderDistancePx: number;
  savingsPct: number;
}

export interface PlanOptions {
  /** default false → pharmacy becomes drop-off first + pick-up last */
  prescriptionReady?: boolean;
  HeldKarpMaxStops?: number;
  /**
   * Explicit per-product location choice (from the Clarify picker).
   * The router otherwise uses each product's DEFAULT (first) location and never
   * silently switches: alternates like deli vs dairy are different items and
   * need user confirmation, not a distance optimization.
   */
  locationOverrides?: Record<string, string>;
}

interface StopNode {
  key: string; // unique per stop (product id, or pharmacy:dropoff/pickup)
  productId: string;
  name: string;
  aisleLabel?: string;
  locationId: string;
  visit?: "dropoff" | "pickup";
  tags: Set<string>;
  nodeId: string; // virtual graph node
}

const HARD = 4_000_000;
// Soft preferences are tiebreakers only: they must never override real
// geography (a 100px detour beats any of these).
const COLD_LATE = 60;
const HEAVY_EARLY = 60;
const FRAGILE_LATE = 60;
const DROPOFF_FIRST = 1500;
const PICKUP_LAST = 1500;

function isLast(s: StopNode): boolean {
  return s.tags.has("hot") || s.productId === "ice";
}
function isFrozen(s: StopNode): boolean {
  return s.tags.has("frozen") && !isLast(s);
}
function isCold(s: StopNode): boolean {
  return s.tags.has("cold");
}

function popcount(n: number): number {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}

/**
 * Pairwise walking distances (px) between entrances and default-location stops.
 * Exported for tests and the future /explain endpoint.
 */
export function pairwiseDistances(
  store: StoreDoc,
  productIds: string[],
): { entranceIds: string[]; stopNodeIds: string[]; dist: (a: string, b: string) => number } {
  const g = new StoreGraph();
  for (const n of store.nodes) g.addNode(n.id, n.xy[0], n.xy[1]);
  const locById = new Map(store.locations.map((l) => [l.id, l]));
  const prodById = new Map(store.products.map((p) => [p.id, p]));
  // insert default-location stops, splitting edges
  const stopAt = new Map<string, { a: string; b: string; t: number; nodeId: string }>();
  productIds.forEach((pid, i) => {
    const p = prodById.get(pid);
    if (!p) throw new Error(`unknown product: ${pid}`);
    const loc = locById.get(p.locations[0]!)!;
    stopAt.set(`t${i}`, { a: loc.edge[0]!, b: loc.edge[1]!, t: loc.t, nodeId: `tstop${i}` });
  });
  const g2 = new StoreGraph();
  for (const [id, pt] of g.xy) g2.addNode(id, pt.x, pt.y);
  for (const e of store.edges) {
    const splits = [...stopAt.values()]
      .filter((s) => [s.a, s.b].sort().join("|") === [e.a, e.b].sort().join("|"))
      .map((s) => {
        const sorted = [s.a, s.b].sort();
        return { ...s, t: sorted[0] === s.a ? s.t : 1 - s.t };
      })
      .sort((p, q) => p.t - q.t);
    const [u, v] = [e.a, e.b].sort() as [string, string];
    const pu = g.xy.get(u)!;
    const pv = g.xy.get(v)!;
    let prevId = u;
    let prevT = 0;
    for (const sp of splits) {
      g2.addNode(sp.nodeId, pu.x + (pv.x - pu.x) * sp.t, pu.y + (pv.y - pu.y) * sp.t);
      g2.addEdge(prevId, sp.nodeId, Math.max(1, e.len * (sp.t - prevT)));
      prevId = sp.nodeId;
      prevT = sp.t;
    }
    g2.addEdge(prevId, v, Math.max(splits.length ? 1 : e.len, e.len * (1 - prevT)));
  }
  const entranceIds = store.nodes
    .filter((n) => n.type === "entrance" || n.type === "exit")
    .map((n) => n.id);
  const stopNodeIds = [...stopAt.values()].map((s) => s.nodeId);
  const cache = new Map<string, Map<string, number>>();
  for (const k of [...entranceIds, ...stopNodeIds]) cache.set(k, g2.dijkstra(k).dist);
  return {
    entranceIds,
    stopNodeIds,
    dist: (a, b) => cache.get(a)!.get(b) ?? Infinity,
  };
}

export function planRoute(
  store: StoreDoc,
  productIds: string[],
  options: PlanOptions = {},
): RouteResult {
  const prescriptionReady = options.prescriptionReady ?? false;
  const hkMax = options.HeldKarpMaxStops ?? 15;

  const productById = new Map(store.products.map((p) => [p.id, p]));
  const locationById = new Map(store.locations.map((l) => [l.id, l]));

  // ---- expand pharmacy service into 1–2 stops ----
  interface Expanded {
    productId: string;
    visit?: "dropoff" | "pickup";
  }
  const expanded: Expanded[] = [];
  for (const pid of productIds) {
    const svc = store.services.find((s) => s.id === pid);
    if (svc && svc.mode === "dropoff_pickup" && !prescriptionReady) {
      expanded.push({ productId: pid, visit: "dropoff" });
      expanded.push({ productId: pid, visit: "pickup" });
    } else {
      expanded.push({ productId: pid });
    }
  }

  // ---- choose default location per stop ----
  const locChoices = new Map<string, string[]>(); // stop key -> location ids
  const stops: StopNode[] = expanded.map((e, i) => {
    const p = productById.get(e.productId);
    if (!p) throw new Error(`unknown product: ${e.productId}`);
    const key = e.visit ? `${e.productId}:${e.visit}#${i}` : `${e.productId}#${i}`;
    locChoices.set(key, [...p.locations]);
    return {
      key,
      productId: e.productId,
      name: p.name,
      aisleLabel: p.aisleLabel,
      locationId: p.locations[0]!,
      visit: e.visit,
      tags: new Set(p.tags),
      nodeId: `stop:${key}`,
    };
  });

  // ---- base graph (walkways only) ----
  const base = new StoreGraph();
  for (const n of store.nodes) base.addNode(n.id, n.xy[0], n.xy[1]);
  for (const e of store.edges) base.addEdge(e.a, e.b, e.len);

  const entrances = store.nodes.filter(
    (n) => n.type === "entrance" || n.type === "exit",
  );
  if (entrances.length === 0) throw new Error("store has no entrances");

  // Insert stop points, splitting their edges at t.
  function graphWith(locOf: Map<string, string>): StoreGraph {
    const g = new StoreGraph();
    for (const [id, p] of base.xy) g.addNode(id, p.x, p.y);
    // copy walkway edges except ones split by a stop
    const splitByEdge = new Map<string, Array<{ stop: StopNode; t: number }>>();
    for (const s of stops) {
      const loc = locationById.get(locOf.get(s.key)!)!;
      const key = [loc.edge[0], loc.edge[1]].sort().join("|");
      if (!splitByEdge.has(key)) splitByEdge.set(key, []);
      // normalize t to the sorted orientation
      const sorted: [string, string] = [loc.edge[0], loc.edge[1]].sort() as [string, string];
      const flipped = sorted[0] !== loc.edge[0];
      splitByEdge.get(key)!.push({ stop: s, t: flipped ? 1 - loc.t : loc.t });
    }
    for (const e of store.edges) {
      const key = [e.a, e.b].sort().join("|");
      const splits = (splitByEdge.get(key) ?? []).sort((p, q) => p.t - q.t);
      const [u, v] = [e.a, e.b].sort() as [string, string];
      const pu = base.xy.get(u)!;
      const pv = base.xy.get(v)!;
      let prevId = u;
      let prevT = 0;
      for (const sp of splits) {
        const x = pu.x + (pv.x - pu.x) * sp.t;
        const y = pu.y + (pv.y - pu.y) * sp.t;
        g.addNode(sp.stop.nodeId, x, y);
        g.addEdge(prevId, sp.stop.nodeId, Math.max(1, e.len * (sp.t - prevT)));
        prevId = sp.stop.nodeId;
        prevT = sp.t;
      }
      g.addEdge(prevId, v, Math.max(splits.length ? 1 : e.len, e.len * (1 - prevT)));
    }
    return g;
  }

  function solveFor(locOf: Map<string, string>) {
    const g = graphWith(locOf);
    const keyNodes = [...entrances.map((e) => e.id), ...stops.map((s) => s.nodeId)];
    const distFrom = new Map<string, Map<string, number>>();
    const prevFrom = new Map<string, Map<string, string | null>>();
    for (const k of keyNodes) {
      const { dist, prev } = g.dijkstra(k);
      distFrom.set(k, dist);
      prevFrom.set(k, prev);
    }
    const D = (a: string, b: string): number => distFrom.get(a)!.get(b) ?? Infinity;

    const n = stops.length;
    const penalty = (j: number, mask: number): number => {
      const s = stops[j]!;
      let p = 0;
      const visited = popcount(mask);
      const after = n - visited - 1;
      // precedence: pickup after dropoff
      if (s.visit === "pickup") {
        const dropIdx = stops.findIndex(
          (o) => o.productId === s.productId && o.visit === "dropoff",
        );
        if (dropIdx >= 0 && !(mask & (1 << dropIdx))) p += HARD;
      }
      const unvisited = stops.filter((_, k) => !(mask & (1 << k)) && k !== j);
      if (isLast(s)) {
        if (unvisited.some((o) => !isLast(o))) p += HARD;
      } else if (isFrozen(s)) {
        if (unvisited.some((o) => !isFrozen(o) && !isLast(o))) p += HARD;
      }
      if (isCold(s)) p += COLD_LATE * after;
      if (s.tags.has("heavy")) p += HEAVY_EARLY * visited;
      if (s.tags.has("fragile")) p += FRAGILE_LATE * after;
      if (s.visit === "dropoff") p += DROPOFF_FIRST * visited;
      if (s.visit === "pickup") p += PICKUP_LAST * after;
      return p;
    };

    // order solver → {order, dist} (dist excludes penalties)
    function solveOrder(dist: (a: number, b: number) => number, start: (j: number) => number, end: (i: number) => number): { order: number[]; dist: number } {
      if (n === 0) return { order: [], dist: 0 };
      if (n <= hkMax) return heldKarp(dist, start, end);
      return nnTwoOpt(dist, start, end);
    }

    function heldKarp(
      dist: (a: number, b: number) => number,
      start: (j: number) => number,
      end: (i: number) => number,
    ): { order: number[]; dist: number } {
      const size = 1 << n;
      const dp = new Float64Array(size * n).fill(Infinity);
      const par = new Int16Array(size * n).fill(-1);
      for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = start(j) + penalty(j, 0);
      for (let mask = 1; mask < size; mask++) {
        for (let i = 0; i < n; i++) {
          if (!(mask & (1 << i))) continue;
          const cur = dp[mask * n + i];
          if (!isFinite(cur)) continue;
          for (let j = 0; j < n; j++) {
            if (mask & (1 << j)) continue;
            const nm = mask | (1 << j);
            const nd = cur + dist(i, j) + penalty(j, mask);
            if (nd < dp[nm * n + j]) {
              dp[nm * n + j] = nd;
              par[nm * n + j] = i;
            }
          }
        }
      }
      const full = size - 1;
      let best = Infinity;
      let last = -1;
      for (let i = 0; i < n; i++) {
        const tot = dp[full * n + i] + end(i);
        if (tot < best) {
          best = tot;
          last = i;
        }
      }
      // rebuild order, then measure pure distance
      const order: number[] = [];
      let mask = full;
      let cur = last;
      while (cur >= 0) {
        order.push(cur);
        const p = par[mask * n + cur];
        mask &= ~(1 << cur);
        cur = p;
      }
      order.reverse();
      let d = order.length ? start(order[0]!) : 0;
      for (let k = 1; k < order.length; k++) d += dist(order[k - 1]!, order[k]!);
      if (order.length) d += end(order[order.length - 1]!);
      return { order, dist: d };
    }

    function nnTwoOpt(
      dist: (a: number, b: number) => number,
      start: (j: number) => number,
      end: (i: number) => number,
    ): { order: number[]; dist: number } {
      const cost = (o: number[]): number => {
        if (!o.length) return 0;
        let c = start(o[0]!);
        let mask = 0;
        c += penalty(o[0]!, mask);
        mask |= 1 << o[0]!;
        for (let k = 1; k < o.length; k++) {
          c += dist(o[k - 1]!, o[k]!) + penalty(o[k]!, mask);
          mask |= 1 << o[k]!;
        }
        c += end(o[o.length - 1]!);
        return c;
      };
      // greedy
      const remaining = new Set(stops.map((_, i) => i));
      const order: number[] = [];
      let mask = 0;
      while (remaining.size) {
        let bj = -1;
        let bc = Infinity;
        for (const j of remaining) {
          const c =
            (order.length ? dist(order[order.length - 1]!, j) : start(j)) + penalty(j, mask);
          if (c < bc) {
            bc = c;
            bj = j;
          }
        }
        order.push(bj);
        mask |= 1 << bj;
        remaining.delete(bj);
      }
      // 2-opt
      let improved = true;
      let best = cost(order);
      while (improved) {
        improved = false;
        for (let a = 0; a < n - 1; a++) {
          for (let b = a + 1; b < n; b++) {
            const cand = [...order.slice(0, a), ...order.slice(a, b + 1).reverse(), ...order.slice(b + 1)];
            const c = cost(cand);
            if (c < best - 1e-9) {
              order.splice(0, n, ...cand);
              best = c;
              improved = true;
            }
          }
        }
      }
      let d = order.length ? start(order[0]!) : 0;
      for (let k = 1; k < order.length; k++) d += dist(order[k - 1]!, order[k]!);
      if (order.length) d += end(order[order.length - 1]!);
      return { order, dist: d };
    }

    const stopDist = (a: number, b: number) => D(stops[a]!.nodeId, stops[b]!.nodeId);
    let best: { order: number[]; dist: number; ent: string; exit: string } | null = null;
    for (const ent of entrances) {
      for (const ex of entrances) {
        const r = solveOrder(
          stopDist,
          (j) => D(ent.id, stops[j]!.nodeId),
          (i) => D(stops[i]!.nodeId, ex.id),
        );
        if (!best || r.dist < best.dist) best = { ...r, ent: ent.id, exit: ex.id };
      }
    }
    return { best: best!, g, D };
  }

  // ---- default locations (+ explicit overrides from the Clarify picker) ----
  const locOf = new Map(stops.map((s) => [s.key, s.locationId]));
  if (options.locationOverrides) {
    for (const s of stops) {
      const ov = options.locationOverrides[s.productId];
      if (ov && locChoices.get(s.key)!.includes(ov)) locOf.set(s.key, ov);
    }
  }
  const solved = solveFor(locOf);

  const { best, g, D } = solved;
  for (const s of stops) s.locationId = locOf.get(s.key)!;

  // ---- typed-order baseline (nearest entrance, typed stop order, best exit) ----
  let typedBest = Infinity;
  {
    const seq = stops.map((s) => s.nodeId);
    for (const ent of entrances) {
      let d = seq.length ? (D(ent.id, seq[0]!) ?? Infinity) : 0;
      for (let k = 1; k < seq.length; k++) d += D(seq[k - 1]!, seq[k]!) ?? Infinity;
      let tail = 0;
      if (seq.length) {
        tail = Math.min(...entrances.map((ex) => D(seq[seq.length - 1]!, ex.id) ?? Infinity));
      }
      typedBest = Math.min(typedBest, d + tail);
    }
  }

  // ---- polyline + stop records ----
  const polyline: [number, number][] = [];
  const pushLeg = (from: string, to: string) => {
    const { prev } = g.dijkstra(from);
    const chain = StoreGraph.chain(prev, from, to);
    for (const id of chain) {
      const p = g.xy.get(id)!;
      const lastPt = polyline[polyline.length - 1];
      if (!lastPt || lastPt[0] !== p.x || lastPt[1] !== p.y) polyline.push([p.x, p.y]);
    }
  };
  const ordered = best.order.map((i) => stops[i]!);
  if (ordered.length === 0) {
    pushLeg(best.ent, best.exit);
  } else {
    pushLeg(best.ent, ordered[0]!.nodeId);
    for (let k = 1; k < ordered.length; k++) pushLeg(ordered[k - 1]!.nodeId, ordered[k]!.nodeId);
    pushLeg(ordered[ordered.length - 1]!.nodeId, best.exit);
  }

  const outStops: RouteStop[] = ordered.map((s) => {
    const p = g.xy.get(s.nodeId)!;
    const loc = locationById.get(s.locationId)!;
    const sideWord = loc.side === "L" ? "left" : loc.side === "R" ? "right" : "";
    const where = s.visit
      ? s.visit === "dropoff"
        ? "Pharmacy counter — drop off"
        : "Pharmacy counter — pick up"
      : s.aisleLabel ?? s.name;
    return {
      productId: s.productId,
      name: s.visit ? `Pharmacy (${s.visit === "dropoff" ? "drop off" : "pick up"})` : s.name,
      aisleLabel: s.aisleLabel,
      locationId: s.locationId,
      xy: [Math.round(p.x), Math.round(p.y)],
      side: loc.side,
      instruction: sideWord ? `${where} · ${sideWord}` : where,
      visit: s.visit,
    };
  });

  const distancePx = Math.round(best.dist);
  const typed = Math.round(typedBest);
  return {
    entranceId: best.ent,
    exitId: best.exit,
    stops: outStops,
    polyline,
    distancePx,
    typedOrderDistancePx: typed,
    savingsPct: typed > 0 ? Math.max(0, Math.round((1 - best.dist / typed) * 1000) / 10) : 0,
  };
}
