/**
 * Validates data/stores/heb-001/store.json:
 * schema parse, referential integrity, reachability from both entrances.
 *
 * Run: npm run validate-store
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StoreDoc } from "@quickaisle/schema";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = JSON.parse(
  readFileSync(join(root, "data/stores/heb-001/store.json"), "utf8"),
);
const store = StoreDoc.parse(raw);

const errors: string[] = [];
const nodeIds = new Set(store.nodes.map((n) => n.id));
const edgeKeys = new Set<string>();
const adj = new Map<string, string[]>();
for (const n of store.nodes) adj.set(n.id, []);

for (const e of store.edges) {
  if (!nodeIds.has(e.a)) errors.push(`edge references unknown node ${e.a}`);
  if (!nodeIds.has(e.b)) errors.push(`edge references unknown node ${e.b}`);
  edgeKeys.add([e.a, e.b].sort().join("|"));
  adj.get(e.a)?.push(e.b);
  adj.get(e.b)?.push(e.a);
  // len should match Euclidean distance (rounded)
  const pa = store.nodes.find((n) => n.id === e.a)!;
  const pb = store.nodes.find((n) => n.id === e.b)!;
  if (pa && pb) {
    const euclid = Math.round(Math.hypot(pb.xy[0] - pa.xy[0], pb.xy[1] - pa.xy[1]));
    if (Math.abs(e.len - euclid) > 1) {
      errors.push(`edge ${e.a}-${e.b} len ${e.len} != euclid ${euclid}`);
    }
  }
}

const locIds = new Set(store.locations.map((l) => l.id));
for (const l of store.locations) {
  const key = [...l.edge].sort().join("|");
  if (!edgeKeys.has(key)) errors.push(`location ${l.id} references unknown edge ${l.edge}`);
}

for (const p of store.products) {
  for (const lid of p.locations) {
    if (!locIds.has(lid)) errors.push(`product ${p.id} references unknown location ${lid}`);
  }
  if (!p.aisleLabel) errors.push(`product ${p.id} has no aisleLabel`);
}

for (const s of store.services) {
  if (!nodeIds.has(s.node)) errors.push(`service ${s.id} references unknown node ${s.node}`);
}

// reachability: every location's edge endpoints reachable from every entrance
const entrances = store.nodes.filter((n) => n.type === "entrance" || n.type === "exit");
if (entrances.length === 0) errors.push("no entrances");
for (const ent of entrances) {
  const seen = new Set<string>([ent.id]);
  const q = [ent.id];
  while (q.length) {
    const cur = q.pop()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        q.push(nb);
      }
    }
  }
  for (const l of store.locations) {
    if (!seen.has(l.edge[0]) || !seen.has(l.edge[1])) {
      errors.push(`location ${l.id} unreachable from ${ent.id}`);
    }
  }
}

// directory coverage: every gold item has a product
const gold = JSON.parse(
  readFileSync(join(root, "eval/gold/directory.json"), "utf8"),
) as { items: Array<{ name: string }> };
const names = new Set(store.products.map((p) => p.name));
for (const item of gold.items) {
  if (!names.has(item.name)) errors.push(`gold item missing from store: ${item.name}`);
}

if (errors.length) {
  console.error(`FAIL: ${errors.length} problem(s)`);
  for (const e of errors.slice(0, 40)) console.error(` - ${e}`);
  process.exit(1);
}
console.log(
  `OK: ${store.products.length} products, ${store.locations.length} locations reachable from ${entrances.map((e) => e.id).join(", ")}`,
);
