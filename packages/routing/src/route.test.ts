import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StoreDoc, type StoreDoc as StoreDocType } from "@quickaisle/schema";
import { planRoute, pairwiseDistances } from "./route.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const store: StoreDocType = StoreDoc.parse(
  JSON.parse(readFileSync(join(root, "data/stores/heb-001/store.json"), "utf8")),
);

const orderOf = (r: ReturnType<typeof planRoute>) => r.stops.map((s) => s.productId);

describe("acceptance", () => {
  it("Test A: prescriptions ready → left in, loop, pharmacy, right out", () => {
    const r = planRoute(
      store,
      ["pharmacy", "eggs", "produce", "cereal", "cheese", "chicken", "shaving-needs"],
      { prescriptionReady: true },
    );
    assert.equal(r.entranceId, "ent_L");
    assert.equal(r.exitId, "ent_R");
    assert.deepEqual(orderOf(r), [
      "produce",
      "cereal",
      "shaving-needs",
      "chicken",
      "eggs",
      "cheese",
      "pharmacy",
    ]);
    assert.ok(r.savingsPct > 0);
    assert.ok(r.polyline.length > 10);
  });

  it("Test A variant: prescription NOT ready → right in, drop off first, pick up last", () => {
    const ids = ["pharmacy", "eggs", "produce", "cereal", "cheese", "chicken", "shaving-needs"];
    const r = planRoute(store, ids, { prescriptionReady: false });
    assert.equal(r.entranceId, "ent_R");
    assert.equal(r.exitId, "ent_R");
    assert.equal(r.stops[0]!.productId, "pharmacy");
    assert.equal(r.stops[0]!.visit, "dropoff");
    const last = r.stops[r.stops.length - 1]!;
    assert.equal(last.productId, "pharmacy");
    assert.equal(last.visit, "pickup");
    const middle = orderOf(r).slice(1, -1);
    // same cold-chain tail as the hand route (check before sorting)
    assert.ok(middle.indexOf("eggs") < middle.indexOf("cheese"));
    assert.deepEqual([...middle].sort(), [
      "cereal",
      "cheese",
      "chicken",
      "eggs",
      "produce",
      "shaving-needs",
    ]);
    // NOTE: the hand-drawn variant loops produce→cereal→razors, but from the
    // pharmacy (south-east) razors-first is ~6% shorter, so the solver takes it.
    // Guard: the solver must never do WORSE than the hand route.
    const { stopNodeIds, dist } = pairwiseDistances(store, ids);
    const idx = new Map(ids.map((id, i) => [id, i]));
    const hand = ["pharmacy", "produce", "cereal", "shaving-needs", "chicken", "eggs", "cheese", "pharmacy"];
    let handDist = dist("ent_R", stopNodeIds[idx.get(hand[0]!)!]!);
    for (let k = 1; k < hand.length; k++) {
      handDist += dist(stopNodeIds[idx.get(hand[k - 1]!)!]!, stopNodeIds[idx.get(hand[k]!)!]!);
    }
    handDist += dist(stopNodeIds[idx.get("pharmacy")!]!, "ent_R");
    assert.ok(r.distancePx <= Math.round(handDist));
  });

  it("Test B: left in, water → pickles → cookies → sushi → frozen, right out", () => {
    const r = planRoute(store, ["cookies", "pickles", "water", "sushi", "frozen-foods"]);
    assert.equal(r.entranceId, "ent_L");
    assert.equal(r.exitId, "ent_R");
    assert.deepEqual(orderOf(r), ["water", "pickles", "cookies", "sushi", "frozen-foods"]);
    assert.ok(r.savingsPct > 0);
  });
});

describe("properties", () => {
  const prodById = new Map(store.products.map((p) => [p.id, p]));
  const untagged = store.products
    .filter((p) => p.tags.length === 0 && p.locations.length === 1)
    .map((p) => p.id);

  it("visits every stop exactly once", () => {
    const ids = ["cereal", "cookies", "pickles", "salsa", "soup", "crackers", "produce"];
    const r = planRoute(store, ids);
    assert.deepEqual(orderOf(r).sort(), [...ids].sort());
  });

  it("frozen is never before a non-frozen stop", () => {
    const ids = ["frozen-foods", "cereal", "cookies", "sushi", "eggs"];
    const r = planRoute(store, ids);
    const idxFrozen = orderOf(r).indexOf("frozen-foods");
    for (const s of r.stops.slice(0, idxFrozen)) {
      const p = prodById.get(s.productId)!;
      assert.equal(p.tags.includes("frozen") || s.productId === "ice", false);
    }
  });

  it("hot/deli and ice go last", () => {
    const r = planRoute(store, ["ice", "deli", "cereal", "cookies"]);
    const ids = orderOf(r);
    assert.deepEqual(ids.slice(-2).sort(), ["deli", "ice"]);
  });

  it("Held-Karp equals brute force on random ≤7-stop untagged lists", () => {
    const lists = [
      untagged.slice(0, 5),
      untagged.slice(5, 12).slice(0, 7),
      untagged.slice(20, 26),
    ];
    for (const ids of lists) {
      const { entranceIds, stopNodeIds, dist } = pairwiseDistances(store, ids);
      const perms = (arr: number[]): number[][] =>
        arr.length <= 1
          ? [arr]
          : arr.flatMap((v, i) =>
              perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [v, ...p]),
            );
      let best = Infinity;
      for (const ent of entranceIds) {
        for (const ex of entranceIds) {
          for (const perm of perms(ids.map((_, i) => i))) {
            let d = dist(ent, stopNodeIds[perm[0]!]!);
            for (let k = 1; k < perm.length; k++) {
              d += dist(stopNodeIds[perm[k - 1]!]!, stopNodeIds[perm[k]!]!);
            }
            d += dist(stopNodeIds[perm[perm.length - 1]!]!, ex);
            if (d < best) best = d;
          }
        }
      }
      const r = planRoute(store, ids);
      assert.ok(Math.abs(r.distancePx - Math.round(best)) <= 2);
    }
  });

  it("uses default locations unless the picker overrides them", () => {
    // chicken/cheese have a deli alternate that is sometimes shorter —
    // the router must NOT silently switch to it (different items).
    const r = planRoute(store, ["chicken", "cheese", "cereal"], { prescriptionReady: true });
    const loc = new Map(r.stops.map((s) => [s.productId, s.locationId]));
    assert.equal(loc.get("chicken"), "loc-market");
    assert.equal(loc.get("cheese"), "loc-dairy");
    const ov = planRoute(store, ["chicken", "cheese", "cereal"], {
      prescriptionReady: true,
      locationOverrides: { chicken: "loc-deli" },
    });
    const ovLoc = new Map(ov.stops.map((s) => [s.productId, s.locationId]));
    assert.equal(ovLoc.get("chicken"), "loc-deli");
    assert.equal(ovLoc.get("cheese"), "loc-dairy");
  });

  it("is deterministic", () => {
    const ids = ["pharmacy", "eggs", "produce", "cereal", "cheese", "chicken", "shaving-needs"];
    const a = planRoute(store, ids, { prescriptionReady: true });
    const b = planRoute(store, ids, { prescriptionReady: true });
    assert.deepEqual(a, b);
  });
});
