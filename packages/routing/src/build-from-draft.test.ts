import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildStoreFromDraft, type DraftInput } from "./build-from-draft.ts";
import { doorLabel, planRoute } from "./route.ts";

const draft = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../../data/stores/store-002/draft-ingest-v1.json"),
    "utf8",
  ),
) as DraftInput;

const aisleEdge = (a: string, b: string): boolean => {
  const ma = a.match(/^a(.+)-[01]$/);
  const mb = b.match(/^a(.+)-[01]$/);
  return !!ma && !!mb && ma[1] === mb[1];
};

describe("buildStoreFromDraft (store-002 draft)", () => {
  const { store, warnings } = buildStoreFromDraft(draft, {
    storeId: "store-002",
    imageSize: [1662, 1064],
  });

  it("builds a valid store: 39 aisle edges, 2 entrances", () => {
    assert.equal(store.storeId, "store-002");
    const aisleEdges = store.edges.filter((e) => aisleEdge(e.a, e.b));
    assert.equal(aisleEdges.length, 39);
    const doors = store.nodes.filter((n) => n.type === "entrance" || n.type === "exit");
    assert.equal(doors.length, 2);
    console.log(`store-002 warnings (${warnings.length}): ${warnings.slice(0, 5).join(" | ") || "none"}`);
  });

  it("planRoute routes the test list with a plausible stop order", () => {
    const ids = ["coffee", "diapers", "frozen-foods", "cat-litter"];
    for (const id of ids) {
      assert.ok(store.products.some((p) => p.id === id), `missing product ${id}`);
    }
    const r = planRoute(store, ids, {});
    assert.equal(r.stops.length, 4);
    assert.deepEqual(
      r.stops.map((s) => s.productId).sort(),
      [...ids].sort(),
    );
    assert.ok(r.entranceId.startsWith("door-"));
    assert.ok(r.exitId.startsWith("door-"));
    console.log(`store-002 test route: in ${r.entranceId} → ${r.stops.map((s) => s.name).join(" → ")} → out ${r.exitId}`);
  });

  it("doorLabel names built doors by position, passes others through", () => {
    assert.equal(doorLabel(store, "door-0"), "bottom-left entrance");
    assert.equal(doorLabel(store, "door-1"), "bottom-right entrance");
    assert.equal(doorLabel(store, "ent_L"), "ent_L");
    assert.equal(doorLabel(store, "door-9"), "door-9");
  });

  it("walkways: [water] (aisle 3, left side) touches door-0", () => {
    const r = planRoute(store, ["water"], {});
    assert.equal(r.stops.length, 1);
    assert.ok(
      r.entranceId === "door-0" || r.exitId === "door-0",
      `expected door-0, got in ${r.entranceId} out ${r.exitId}`,
    );
  });
});

describe("buildStoreFromDraft (synthetic two-block draft)", () => {
  const mini: DraftInput = {
    aisles: [
      { n: "1", orientation: "vertical", box: [100, 100, 120, 400], items: ["Apples"] },
      { n: "2", orientation: "vertical", box: [200, 100, 220, 400], items: ["Bread"] },
      { n: "16", orientation: "horizontal", box: [700, 100, 950, 120], items: ["Milk"] },
      { n: "17", orientation: "horizontal", box: [700, 200, 950, 220], items: ["Eggs"] },
    ],
    departments: [{ name: "Deli", box: [400, 500, 460, 560] }],
    entrances: [{ box: [400, 850, 450, 900], kind: "both" }],
  };
  const { store } = buildStoreFromDraft(mini, { storeId: "mini", imageSize: [1000, 1000] });
  const hasEdge = (a: string, b: string): boolean =>
    store.edges.some(
      (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a),
    );

  it("connects block walkways front and back", () => {
    assert.ok(hasEdge("a1-0", "a2-0"));
    assert.ok(hasEdge("a1-1", "a2-1"));
    assert.ok(hasEdge("a16-0", "a17-0"));
    assert.ok(hasEdge("a16-1", "a17-1"));
  });

  it("connects everything and routes across blocks", () => {
    const doors = store.nodes.filter((n) => n.type === "entrance" || n.type === "exit");
    assert.equal(doors.length, 1);
    assert.ok(store.products.some((p) => p.id === "deli"));
    const r = planRoute(store, ["apples", "milk"], {});
    assert.equal(r.stops.length, 2);
  });
});
