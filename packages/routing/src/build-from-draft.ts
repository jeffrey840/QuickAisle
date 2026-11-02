import { StoreDoc, type StoreDoc as StoreDocType } from "@quickaisle/schema";

/**
 * Build a routable store.json from a merged /ingest draft (aisle boxes
 * on a 0–1000 grid + item labels). The output passes StoreDoc and works
 * with planRoute unchanged.
 *
 * Structural input on purpose: the routing package must not depend on
 * server/ code. MergedIngest is structurally compatible.
 */

export interface DraftAisle {
  n: string;
  orientation: "vertical" | "horizontal";
  box: number[];
  items: string[];
}

export interface DraftInput {
  aisles: DraftAisle[];
  departments: Array<{ name: string; box: number[] }>;
  entrances: Array<{ box: number[]; kind: string }>;
}

export interface BuildOpts {
  storeId: string;
  imageSize: [number, number];
  mapImage?: string;
}

export interface BuildResult {
  store: StoreDocType;
  warnings: string[];
}

type XY = [number, number];

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function normItem(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function numericPart(n: string): number | null {
  const m = n.trim().match(/^\d+/);
  return m ? Number(m[0]) : null;
}

const dist = (a: XY, b: XY): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function buildStoreFromDraft(draft: DraftInput, opts: BuildOpts): BuildResult {
  const warnings: string[] = [];
  const [W, H] = opts.imageSize;
  if (draft.aisles.length === 0) throw new Error("draft has no aisles");

  const scale = (box: number[]): { x0: number; y0: number; x1: number; y1: number } => {
    const [ax = 0, ay = 0, bx = 0, by = 0] = box;
    return {
      x0: Math.round((Math.min(ax, bx) / 1000) * W),
      y0: Math.round((Math.min(ay, by) / 1000) * H),
      x1: Math.round((Math.max(ax, bx) / 1000) * W),
      y1: Math.round((Math.max(ay, by) / 1000) * H),
    };
  };

  interface NodeRec {
    id: string;
    xy: XY;
    type: string;
  }
  const nodes: NodeRec[] = [];
  const edges: Array<{ a: string; b: string; len: number }> = [];
  const nodeIds = new Set<string>();
  const addNode = (id: string, xy: XY, type: string): void => {
    if (nodeIds.has(id)) throw new Error(`duplicate node id: ${id}`);
    nodeIds.add(id);
    nodes.push({ id, xy, type });
  };
  const addEdge = (a: string, b: string): void => {
    if (a === b) return;
    const pa = nodes.find((n) => n.id === a)!.xy;
    const pb = nodes.find((n) => n.id === b)!.xy;
    edges.push({ a, b, len: Math.max(1, Math.round(dist(pa, pb))) });
  };

  // ---- aisle end nodes + internal edges ----
  interface AisleRec {
    n: string;
    num: number | null;
    orientation: "vertical" | "horizontal";
    ends: [string, string];
    y0: number;
    y1: number;
    x0: number;
    x1: number;
    items: string[];
  }
  const aisleRecs: AisleRec[] = [];
  const seenN = new Set<string>();
  for (const a of draft.aisles) {
    const n = a.n.trim();
    if (seenN.has(n)) {
      warnings.push(`duplicate aisle n="${n}" ignored`);
      continue;
    }
    seenN.add(n);
    const num = numericPart(n);
    if (num === null) warnings.push(`aisle n="${n}" is non-numeric`);
    const { x0, y0, x1, y1 } = scale(a.box);
    const cx = Math.round((x0 + x1) / 2);
    const cy = Math.round((y0 + y1) / 2);
    const e0 = `a${n}-0`;
    const e1 = `a${n}-1`;
    if (a.orientation === "vertical") {
      addNode(e0, [cx, y0], "junction");
      addNode(e1, [cx, y1 === y0 ? y0 + 1 : y1], "junction");
    } else {
      addNode(e0, [x0, cy], "junction");
      addNode(e1, [x1 === x0 ? x0 + 1 : x1, cy], "junction");
    }
    addEdge(e0, e1);
    const items = [...new Set(a.items.map(normItem).filter(Boolean))];
    if (items.length === 0) warnings.push(`aisle ${n} has 0 items`);
    aisleRecs.push({ n, num, orientation: a.orientation, ends: [e0, e1], y0, y1, x0, x1, items });
  }

  // ---- blocks: same orientation, consecutive numbers, lined-up ends ----
  const lineup = (a: AisleRec, b: AisleRec, tol: number): boolean => {
    if (a.orientation === "vertical") {
      return Math.abs(a.y0 - b.y0) <= tol * H && Math.abs(a.y1 - b.y1) <= tol * H;
    }
    return Math.abs(a.x0 - b.x0) <= tol * W && Math.abs(a.x1 - b.x1) <= tol * W;
  };
  for (const o of ["vertical", "horizontal"] as const) {
    const group = aisleRecs
      .filter((a) => a.orientation === o && a.num !== null)
      .sort((a, b) => a.num! - b.num! || (a.n < b.n ? -1 : 1));
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1]!;
      const cur = group[i]!;
      if (cur.num === prev.num! + 1 && lineup(prev, cur, 0.08)) {
        addEdge(prev.ends[0], cur.ends[0]);
        addEdge(prev.ends[1], cur.ends[1]);
      }
    }
  }

  // ---- entrances: HEB types both doors "entrance"; planRoute tries all pairs ----
  const nearestTo = (xy: XY, exclude: string): string | null => {
    let best: string | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      if (n.id === exclude) continue;
      const d = dist(xy, n.xy);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  };
  draft.entrances.forEach((e, i) => {
    const { x0, y0, x1, y1 } = scale(e.box);
    const id = `door-${i}`;
    addNode(id, [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)], e.kind === "exit" ? "exit" : "entrance");
    const near = nearestTo(nodes[nodes.length - 1]!.xy, id);
    if (near) addEdge(id, near);
  });

  // ---- departments: node + nearest edge ----
  const deptEdges = new Map<string, [string, string]>();
  draft.departments.forEach((d, i) => {
    const { x0, y0, x1, y1 } = scale(d.box);
    let id = `dept-${slug(d.name.trim()) || i}`;
    if (nodeIds.has(id)) id = `${id}-${i}`;
    addNode(id, [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)], "junction");
    const near = nearestTo(nodes[nodes.length - 1]!.xy, id);
    if (near) {
      addEdge(id, near);
      deptEdges.set(d.name, [id, near]);
    } else {
      deptEdges.set(d.name, [id, id]);
    }
  });

  // ---- connect components via closest cross-component pairs ----
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const comps = (): Map<string, string[]> => {
    for (const n of nodes) parent.set(n.id, n.id);
    const union = (a: string, b: string): void => {
      parent.set(find(a), find(b));
    };
    for (const e of edges) union(e.a, e.b);
    const m = new Map<string, string[]>();
    for (const n of nodes) {
      const r = find(n.id);
      if (!m.has(r)) m.set(r, []);
      m.get(r)!.push(n.id);
    }
    return m;
  };
  for (;;) {
    const groups = [...comps().values()];
    if (groups.length <= 1) break;
    let bestPair: [string, string] | null = null;
    let bestD = Infinity;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        for (const a of groups[i]!) {
          for (const b of groups[j]!) {
            const d = dist(
              nodes.find((n) => n.id === a)!.xy,
              nodes.find((n) => n.id === b)!.xy,
            );
            if (d < bestD) {
              bestD = d;
              bestPair = [a, b];
            }
          }
        }
      }
    }
    addEdge(bestPair![0], bestPair![1]);
  }

  // ---- products: one per unique item text ----
  interface ProdRec {
    id: string;
    name: string;
    locations: string[];
    aisleLabel?: string;
  }
  const products: ProdRec[] = [];
  const locations: Array<{ id: string; edge: [string, string]; t: number; side: "C" }> = [];
  const usedIds = new Set<string>();
  const itemAisles = new Map<string, AisleRec[]>();
  for (const a of aisleRecs) {
    for (const item of a.items) {
      if (!itemAisles.has(item)) itemAisles.set(item, []);
      itemAisles.get(item)!.push(a);
    }
  }
  const takeId = (base: string): string | null => {
    if (!base) return null;
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    let i = 2;
    while (usedIds.has(`${base}-${i}`)) i++;
    usedIds.add(`${base}-${i}`);
    return `${base}-${i}`;
  };
  for (const [item, aisles] of itemAisles) {
    if (aisles.length > 3) warnings.push(`"${item}" listed on ${aisles.length} aisles`);
    const id = takeId(slug(item));
    if (!id) continue;
    const locIds: string[] = [];
    aisles.forEach((a, j) => {
      const k = a.items.length;
      const t = (a.items.indexOf(item) + 1) / (k + 1);
      const lid = `loc-${id}-${j}`;
      locations.push({ id: lid, edge: [a.ends[0], a.ends[1]], t, side: "C" });
      locIds.push(lid);
    });
    products.push({
      id,
      name: titleCase(item),
      locations: locIds,
      aisleLabel: `Aisle ${aisles[0]!.n}`,
    });
  }
  draft.departments.forEach((d) => {
    const edge = deptEdges.get(d.name)!;
    if (edge[0] === edge[1]) return;
    const base = slug(d.name.trim());
    const id = usedIds.has(base) ? takeId(`${base}-dept`) : takeId(base);
    if (!id) return;
    const lid = `loc-${id}-0`;
    locations.push({ id: lid, edge, t: 0.5, side: "C" });
    products.push({ id, name: d.name.trim(), locations: [lid] });
  });

  const store = {
    storeId: opts.storeId,
    version: 1,
    mapImage: opts.mapImage ?? "map.png",
    imageSize: opts.imageSize,
    nodes: nodes.map((n) => ({ id: n.id, xy: n.xy, type: n.type })),
    edges,
    locations,
    products,
    services: [],
  };

  // ---- validate ----
  const parsed = StoreDoc.safeParse(store);
  if (!parsed.success) {
    throw new Error(`draft build failed schema: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  const seen = new Set<string>([nodes[0]!.id]);
  const queue = [nodes[0]!.id];
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push(e.b);
    adj.get(e.b)!.push(e.a);
  }
  while (queue.length > 0) {
    for (const nb of adj.get(queue.pop()!) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  if (seen.size !== nodes.length) throw new Error("draft build left the graph disconnected");
  for (const p of products) {
    if (p.locations.length === 0) throw new Error(`product has no locations: ${p.id}`);
  }
  const edgeKeys = new Set(edges.map((e) => [e.a, e.b].sort().join("|")));
  for (const l of locations) {
    if (!edgeKeys.has([l.edge[0], l.edge[1]].sort().join("|"))) {
      throw new Error(`location edge missing: ${l.id}`);
    }
  }
  for (const [label, ids] of [
    ["node", nodes.map((n) => n.id)],
    ["location", locations.map((l) => l.id)],
    ["product", products.map((p) => p.id)],
  ] as const) {
    if (new Set(ids).size !== ids.length) throw new Error(`duplicate ${label} ids`);
  }

  return { store: parsed.data, warnings };
}
