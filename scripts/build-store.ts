/**
 * Builds data/stores/heb-001/store.json from eval/gold/directory.json + the
 * hand-measured geometry in HANDOFF_PLAN.md §4.
 *
 * Also emits the compact catalog for POST /resolve at
 * server/src/catalogs/heb-001.ts (validated in sync by validate-store).
 *
 * Run: npm run build:store
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StoreDoc } from "@quickaisle/schema";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gold = JSON.parse(
  readFileSync(join(root, "eval/gold/directory.json"), "utf8"),
) as { items: Array<{ name: string; aisle: string }>; count: number };

if (gold.items.length !== 167) {
  throw new Error(`expected 167 directory items, got ${gold.items.length}`);
}

// ---------- nodes ----------

type Node = { id: string; xy: [number, number]; type: string };
const nodes: Node[] = [];
const nodeIds = new Set<string>();
function N(id: string, x: number, y: number, type = "junction"): void {
  if (nodeIds.has(id)) throw new Error(`dup node ${id}`);
  nodeIds.add(id);
  nodes.push({ id, xy: [x, y], type });
}

const AISLE_X: Record<number, number> = {
  1: 327, 2: 380, 3: 427, 4: 476, 5: 521, 6: 572, 7: 622, 8: 671,
  9: 723, 10: 773, 11: 815, 12: 865, 13: 910, 14: 962, 15: 1015,
  16: 1097, 17: 1172,
};
const Y_FRONT_W = 660; // aisles 1-10
const Y_FRONT_E = 685; // aisles 11-17
const Y_BACK = 210;
const Y_CROSS = 460; // aisles 11-15 split

N("ent_L", 387, 925, "entrance");
N("ent_R", 598, 930, "entrance");
N("j_ent_L", 387, 835);
N("entry_W", 300, 800);
N("front_W", 300, Y_FRONT_W);
N("back_W", 300, Y_BACK);
N("step_W", 794, Y_FRONT_W);
N("step_E", 794, Y_FRONT_E);
N("front_E", 1182, Y_FRONT_E);
N("back_E", 1182, Y_BACK);
N("wall_T", 1182, 180);
N("wall_S", 1182, 745);
N("cs_J", 660, Y_FRONT_W);
N("conn_J", 900, Y_FRONT_E);
N("mdeli_J", 580, Y_BACK);
N("sushi_J", 778, Y_BACK);
N("mkt_J", 965, Y_BACK);
N("milk_J", 1155, Y_BACK);
N("bak_J", 365, Y_BACK);
N("low_W", 650, 830);
N("low_M", 900, 830);
N("low_E", 1060, 830);
N("pharm", 1140, 840, "counter");
N("bakery", 365, 110, "counter");
N("seafood", 775, 140, "counter");
N("market", 965, 175, "counter");
N("milk", 1155, 95, "counter");
N("deli", 265, 875, "counter");
N("cs", 660, 705, "counter");

for (let a = 1; a <= 17; a++) {
  const x = AISLE_X[a]!;
  const yf = a <= 10 ? Y_FRONT_W : Y_FRONT_E;
  N(`f${a}`, x, yf);
  N(`b${a}`, x, Y_BACK);
  if (a >= 11 && a <= 15) N(`c${a}`, x, Y_CROSS);
}

// ---------- edges (len computed as Euclidean) ----------

type Edge = { a: string; b: string; len: number };
const edges: Edge[] = [];
const byId = new Map(nodes.map((n) => [n.id, n]));
function E(a: string, b: string): void {
  const pa = byId.get(a);
  const pb = byId.get(b);
  if (!pa || !pb) throw new Error(`unknown edge endpoint ${a}-${b}`);
  const len = Math.round(Math.hypot(pb.xy[0] - pa.xy[0], pb.xy[1] - pa.xy[1]));
  edges.push({ a, b, len });
}

function chain(ids: string[]): void {
  for (let i = 1; i < ids.length; i++) E(ids[i - 1]!, ids[i]!);
}

// left entry path
chain(["ent_L", "j_ent_L", "entry_W", "front_W", "back_W"]);
// front walkway west (y=660)
chain(["front_W", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "cs_J", "f8", "f9", "f10", "step_W"]);
// step + front walkway east (y=685)
E("step_W", "step_E");
chain(["step_E", "f11", "f12", "conn_J", "f13", "f14", "f15", "f16", "f17", "front_E"]);
// back walkway (y=210), west → east
chain([
  "back_W", "b1", "bak_J", "b2", "b3", "b4", "b5", "b6", "mdeli_J", "b7",
  "b8", "b9", "b10", "sushi_J", "b11", "b12", "b13", "b14", "mkt_J",
  "b15", "b16", "milk_J", "b17", "back_E",
]);
// cross walkway (y=460)
chain(["c11", "c12", "c13", "c14", "c15"]);
// aisles
for (let a = 1; a <= 17; a++) {
  if (a >= 11 && a <= 15) {
    E(`f${a}`, `c${a}`);
    E(`c${a}`, `b${a}`);
  } else {
    E(`f${a}`, `b${a}`);
  }
}
// right wall dairy walkway
chain(["wall_T", "back_E", "front_E", "wall_S"]);
// lower walkway + connectors
chain(["low_W", "low_M", "low_E"]);
E("ent_R", "low_W");
E("conn_J", "low_M");
E("low_E", "pharm");
E("wall_S", "pharm");
// department stubs
E("bak_J", "bakery");
E("sushi_J", "seafood");
E("mkt_J", "market");
E("milk_J", "milk");
E("entry_W", "deli");
E("cs_J", "cs");

// ---------- locations ----------

type Loc = { id: string; edge: [string, string]; t: number; side: "L" | "R" | "C" };
const locations: Loc[] = [];
const locIds = new Set<string>();
function L(id: string, a: string, b: string, t: number, side: "L" | "R" | "C" = "C"): string {
  if (locIds.has(id)) throw new Error(`dup location ${id}`);
  locIds.add(id);
  locations.push({ id, edge: [a, b], t: Math.round(t * 10000) / 10000, side });
  return id;
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
/** deterministic spread along an aisle so unmapped items don't pile up */
function spread(name: string, lo = 0.2, hi = 0.8): number {
  return lo + hash01(name) * (hi - lo);
}

function yToT(y: number, yFront: number, yBack: number): number {
  return (yFront - y) / (yFront - yBack);
}

// Aisle edge helpers (edge orientation: front → back/cross)
function aisleEdge(a: number, half?: "A" | "B"): [string, string] {
  if (a >= 11 && a <= 15) {
    return half === "A" ? [`c${a}`, `b${a}`] : [`f${a}`, `c${a}`];
  }
  return [`f${a}`, `b${a}`];
}
function aisleYRange(a: number, half?: "A" | "B"): [number, number] {
  if (a >= 11 && a <= 15) {
    return half === "A" ? [Y_CROSS, Y_BACK] : [Y_FRONT_E, Y_CROSS];
  }
  return [a <= 10 ? Y_FRONT_W : Y_FRONT_E, Y_BACK];
}

// ---------- products ----------

type Prod = {
  id: string;
  name: string;
  aliases: string[];
  locations: string[];
  tags: string[];
  aisleLabel?: string;
};
const products: Prod[] = [];
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const HEAVY = new Set([
  "Water", "Charcoal", "Cat Litter", "Dog Food", "Laundry Detergent",
  "Bleach", "Fabric Softener", "Sodas", "Beer", "Juice", "Wine",
]);
const FRAGILE = new Set(["Light Bulbs", "Wine", "Beer"]);

interface AisleTarget {
  aisle: number;
  half?: "A" | "B";
  label: string;
}
/** Map printed directory aisle → walkable target. Trust the map on conflicts. */
function targetFor(name: string, printed: string): AisleTarget {
  const label = (s: string) => s;
  if (name === "Rice") return { aisle: 6, label: "Aisle 6 (directory says 4)" };
  if (name === "Hot Cocoa") return { aisle: 3, label: "Aisle 3 (directory says 16)" };
  if (name === "Pop Tarts") return { aisle: 2, label: "Aisle 2 (directory says 10)" };
  if (name === "Food Wrap/Containers") return { aisle: 14, half: "B", label: "Aisle 14 (directory says 20)" };
  if (name === "Toothpicks") return { aisle: 14, half: "B", label: "Aisle 19? ask staff — trying 14" };
  const m = printed.match(/^(\d+)([AB])?$/);
  if (m) {
    const aisle = Number(m[1]);
    if (aisle >= 1 && aisle <= 17) {
      const half = (m[2] as "A" | "B" | undefined) ?? (aisle >= 11 && aisle <= 15 ? "B" : undefined);
      return { aisle, half, label: label(`Aisle ${printed}`) };
    }
  }
  throw new Error(`unhandled aisle ${printed} for ${name}`);
}

// confirmed shelf positions from §4
const CONFIRMED: Record<string, { y: number; side: "L" | "R" | "C" }> = {
  Cereal: { y: 430, side: "L" },
  Pickles: { y: 495, side: "R" },
  Cookies: { y: 480, side: "L" },
  "Shaving Needs": { y: 560, side: "C" },
};

let autoLoc = 0;
for (const item of gold.items) {
  const { name, aisle: printed } = item;
  const id = slug(name);
  const tags: string[] = [];
  if (HEAVY.has(name)) tags.push("heavy");
  if (FRAGILE.has(name)) tags.push("fragile");

  // special placements (not plain aisle shelves)
  if (name === "Batteries") {
    const loc = L(`loc-${id}`, "f13", "f14", 0.8);
    products.push({ id, name, aliases: [], locations: [loc], tags, aisleLabel: "End cap near aisle 14" });
    continue;
  }
  if (name === "Charcoal" || name === "Matches" || name === "Water") {
    const t = name === "Water" ? 0.05 : name === "Charcoal" ? 0.08 : 0.11;
    const loc = L(`loc-${id}`, "f1", "b1", t);
    products.push({ id, name, aliases: [], locations: [loc], tags, aisleLabel: "By Produce (aisle 1 end)" });
    continue;
  }
  if (name === "Diet Aids") {
    const loc = L(`loc-${id}`, "f15", "f16", 0.2);
    products.push({ id, name, aliases: [], locations: [loc], tags, aisleLabel: "End of 15" });
    continue;
  }
  if (name === "Nutritional Aids/Bars") {
    const loc = L(`loc-${id}`, "f15", "f16", 0.8, "L");
    products.push({ id, name, aliases: ["protein bars"], locations: [loc], tags, aisleLabel: "End of 16" });
    continue;
  }
  if (name === "Gift Cards" || name === "Ice") {
    const loc = L(`loc-${id}`, "cs_J", "cs", 1);
    const itags = name === "Ice" ? ["frozen"] : tags;
    products.push({ id, name, aliases: [], locations: [loc], tags: itags, aisleLabel: "Checkstands" });
    continue;
  }
  if (name === "Hispanic Foods") {
    // §4: check 4 first, then 5
    const [a4, b4] = aisleEdge(4);
    const [a5, b5] = aisleEdge(5);
    const l4 = L(`loc-${id}-4`, a4, b4, spread(name, 0.3, 0.7));
    const l5 = L(`loc-${id}-5`, a5, b5, spread(name + "#2", 0.3, 0.7));
    products.push({ id, name, aliases: [], locations: [l4, l5], tags, aisleLabel: "Aisles 4–5" });
    continue;
  }

  const target = targetFor(name, printed);
  const [ea, eb] = aisleEdge(target.aisle, target.half);
  const conf = CONFIRMED[name];
  let t: number;
  let side: "L" | "R" | "C" = "C";
  if (conf) {
    const [yf, yb] = aisleYRange(target.aisle, target.half);
    t = yToT(conf.y, yf, yb);
    side = conf.side;
  } else {
    t = spread(name);
  }
  const loc = L(`loc-${id}-${autoLoc++}`, ea, eb, t, side);
  const aliases: string[] = [];
  if (name === "Shaving Needs") aliases.push("razor", "razors", "shaving");
  if (name === "Candy") {
    // also at checkstands + seasonal (aisle 10)
    const lcs = L(`loc-${id}-cs`, "cs_J", "cs", 1);
    const [sa, sb] = aisleEdge(10);
    const lsn = L(`loc-${id}-sz`, sa, sb, 0.5);
    products.push({ id, name, aliases: [], locations: [loc, lcs, lsn], tags, aisleLabel: `Aisle ${printed} (+ checkstands)` });
    continue;
  }
  if (name === "Bread") {
    const lb = L(`loc-${id}-bakery`, "bak_J", "bakery", 1);
    products.push({ id, name, aliases: [], locations: [loc, lb], tags, aisleLabel: `Aisle ${printed} (+ bakery fresh)` });
    continue;
  }
  products.push({ id, name, aliases, locations: [loc], tags, aisleLabel: target.label });
}

// ---------- departments & multi-location fresh items ----------

function dept(
  id: string,
  name: string,
  locs: string[],
  extra: Partial<Prod> = {},
): void {
  products.push({ id, name, aliases: [], locations: locs, tags: [], ...extra });
}

const locProduce = L("loc-produce", "back_W", "front_W", yToT(470, Y_FRONT_W, Y_BACK));
const locBakery = L("loc-bakery", "bak_J", "bakery", 1);
const locMarketDeli = L("loc-market-deli", "b6", "mdeli_J", 1);
const locSushi = L("loc-sushi", "b10", "sushi_J", 1);
const locSeafood = L("loc-seafood", "sushi_J", "seafood", 1);
const locMarket = L("loc-market", "mkt_J", "market", 1);
const locMilkFresh = L("loc-milk-fresh", "milk_J", "milk", 1);
const locEggs = L("loc-eggs", "wall_T", "back_E", 0.15);
const locDairy = L("loc-dairy", "back_E", "front_E", (330 - Y_BACK) / (Y_FRONT_E - Y_BACK));
const locFrozen = L("loc-frozen", "f16", "b16", yToT(445, Y_FRONT_E, Y_BACK));
const locDeli = L("loc-deli", "entry_W", "deli", 1);
const locPharmacy = L("loc-pharmacy", "low_E", "pharm", 1);
const locFloral = L("loc-floral", "entry_W", "j_ent_L", 0.5);
const locCheckstands = L("loc-checkstands", "cs_J", "cs", 1);

dept("produce", "Produce", [locProduce], {
  aliases: ["apple", "banana", "orange", "grape", "lettuce", "tomato", "onion", "avocado", "lemon", "lime", "carrot", "celery", "broccoli", "spinach", "strawberry", "blueberry", "melon", "peach", "pear", "pineapple", "cucumber", "cabbage", "garlic", "ginger", "cilantro", "mushroom"],
  aisleLabel: "Produce",
});
dept("bakery", "Bakery", [locBakery], {
  aliases: ["croissant", "donut", "bagel", "fresh bread", "bakery"],
  aisleLabel: "Bakery",
});
dept("market-deli", "Market Deli", [locMarketDeli], {
  aliases: ["deli meat", "cold cuts"],
  tags: ["cold"],
  aisleLabel: "Market Deli",
});
dept("sushi", "Sushi", [locSushi], { tags: ["cold"], aisleLabel: "Sushi" });
dept("seafood", "Seafood", [locSeafood], {
  aliases: ["fish", "shrimp", "salmon"],
  tags: ["cold"],
  aisleLabel: "Seafood",
});
dept("market", "Market", [locMarket], {
  aliases: ["meat", "beef", "pork", "steak", "ground beef"],
  tags: ["cold"],
  aisleLabel: "Market (meat)",
});
dept("milk", "Milk", [locMilkFresh], {
  aliases: ["dairy milk"],
  tags: ["cold"],
  aisleLabel: "Milk (back-right corner)",
});
dept("eggs", "Eggs", [locEggs], { tags: ["cold", "fragile"], aisleLabel: "Eggs (top of dairy wall)" });
dept("dairy", "Dairy", [locDairy], {
  aliases: ["butter", "yogurt", "sour cream", "cream cheese"],
  tags: ["cold"],
  aisleLabel: "Dairy wall",
});
dept("frozen-foods", "Frozen Foods", [locFrozen], {
  aliases: ["frozen", "frozen food", "ice cream", "frozen pizza", "frozen vegetables"],
  tags: ["frozen"],
  aisleLabel: "Frozen (aisle 16)",
});
dept("deli", "Deli", [locDeli], {
  aliases: ["hot food", "rotisserie"],
  tags: ["hot"],
  aisleLabel: "Deli (hot food, front-left)",
});
dept("pharmacy", "Pharmacy", [locPharmacy], {
  aliases: ["prescription", "prescriptions"],
  tags: ["service"],
  aisleLabel: "Pharmacy",
});
dept("floral", "Floral", [locFloral], {
  aliases: ["flowers"],
  aisleLabel: "Floral",
});
dept("checkstands", "Checkstands", [locCheckstands], { aisleLabel: "Checkstands" });

// multi-location fresh items (first location = default)
dept("cheese", "Cheese", [locDairy, locDeli], {
  tags: ["cold"],
  aisleLabel: "Dairy (or deli sliced)",
});
dept("chicken", "Chicken", [locMarket, locDeli, locFrozen], {
  aliases: ["chicken breast", "rotisserie chicken"],
  tags: ["cold"],
  aisleLabel: "Market (or deli / frozen)",
});

// ---------- assemble + validate ----------

const doc = {
  storeId: "heb-001",
  version: 1,
  mapImage: "map.png",
  imageSize: [1268, 1048] as [number, number],
  nodes,
  edges,
  locations,
  products,
  services: [{ id: "pharmacy", node: "pharm", mode: "dropoff_pickup" }],
};

const parsed = StoreDoc.parse(doc);
console.log(
  `store ${parsed.storeId}: ${parsed.nodes.length} nodes, ${parsed.edges.length} edges, ` +
    `${parsed.locations.length} locations, ${parsed.products.length} products`,
);

writeFileSync(
  join(root, "data/stores/heb-001/store.json"),
  JSON.stringify(parsed, null, 1) + "\n",
);
console.log("wrote data/stores/heb-001/store.json");

const catalog = parsed.products.map((p) => ({ id: p.id, name: p.name }));
mkdirSync(join(root, "server/src/catalogs"), { recursive: true });
writeFileSync(
  join(root, "server/src/catalogs/heb-001.ts"),
  "// GENERATED by scripts/build-store.ts — do not edit by hand.\n" +
    "export interface CatalogEntry { id: string; name: string; }\n" +
    'export const HEB_STORE_ID = "heb-001";\n' +
    `export const HEB_CATALOG: CatalogEntry[] = ${JSON.stringify(catalog, null, 1)};\n`,
);
console.log("wrote server/src/catalogs/heb-001.ts");
