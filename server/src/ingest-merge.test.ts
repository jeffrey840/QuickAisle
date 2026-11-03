import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IngestData } from "./ingest-contract.ts";
import {
  ROTATED_FALLBACK_NOTE,
  capMergedIngest,
  combineIngestViews,
  mergeIngestRuns,
  type MergedIngest,
} from "./ingest-merge.ts";

const run = (over: Partial<IngestData> = {}): IngestData => ({
  aisles: [],
  departments: [],
  entrances: [],
  notes: [],
  ...over,
});

describe("mergeIngestRuns", () => {
  it("keeps aisles seen in ≥2 runs; orientation majority; box median", () => {
    const m = mergeIngestRuns([
      run({ aisles: [
        { n: "13", orientation: "vertical", box: [0, 0, 10, 100], items: ["Milk"] },
        { n: "99", orientation: "vertical", box: [0, 0, 1, 1], items: [] },
      ] }),
      run({ aisles: [
        { n: "13", orientation: "vertical", box: [0, 0, 30, 100], items: ["milk"] },
      ] }),
      run({ aisles: [
        { n: "13", orientation: "horizontal", box: [0, 0, 20, 100], items: ["Milk", "Eggs"] },
      ] }),
    ]);
    assert.equal(m.runsOk, 3);
    assert.equal(m.lowConfidence, false);
    assert.deepEqual(m.aisles.map((a) => a.n), ["13"]);
    assert.equal(m.aisles[0]!.orientation, "vertical");
    assert.deepEqual(m.aisles[0]!.box, [0, 0, 20, 100]);
    assert.equal(m.aisles[0]!.agreement, 3);
    // "milk" in 3 runs kept; "eggs" in 1 run dropped
    assert.deepEqual(m.aisles[0]!.items, ["milk"]);
  });

  it("orientation tie breaks by run order", () => {
    const m = mergeIngestRuns([
      run({ aisles: [{ n: "5", orientation: "horizontal", box: [0, 0, 9, 9], items: [] }] }),
      run({ aisles: [{ n: "5", orientation: "vertical", box: [0, 0, 10, 10], items: [] }] }),
    ]);
    assert.equal(m.aisles[0]!.orientation, "horizontal");
  });

  it("item tie places on both aisles", () => {
    const m = mergeIngestRuns([
      run({ aisles: [
        { n: "1", orientation: "vertical", box: [0, 0, 1, 1], items: ["Salsa"] },
        { n: "2", orientation: "vertical", box: [0, 0, 1, 1], items: [] },
      ] }),
      run({ aisles: [
        { n: "1", orientation: "vertical", box: [0, 0, 1, 1], items: [] },
        { n: "2", orientation: "vertical", box: [0, 0, 1, 1], items: ["salsa"] },
      ] }),
    ]);
    assert.deepEqual(m.aisles[0]!.items, ["salsa"]);
    assert.deepEqual(m.aisles[1]!.items, ["salsa"]);
  });

  it("single run returns as-is with lowConfidence", () => {
    const m = mergeIngestRuns([
      run({
        aisles: [{ n: "13A", orientation: "horizontal", box: [1, 2, 3, 4], items: ["  Milk  "] }],
        departments: [{ name: "Produce", box: [0, 0, 5, 5] }],
        entrances: [{ box: [9, 9, 9, 9], kind: "both" }],
        notes: ["unsure"],
      }),
    ]);
    assert.equal(m.runsOk, 1);
    assert.equal(m.lowConfidence, true);
    assert.equal(m.aisles[0]!.n, "13A");
    assert.deepEqual(m.aisles[0]!.items, ["milk"]);
    assert.equal(m.departments[0]!.name, "Produce");
    assert.equal(m.entrances[0]!.kind, "both");
  });

  it("zero runs returns empty", () => {
    const m = mergeIngestRuns([]);
    assert.equal(m.runsOk, 0);
    assert.equal(m.lowConfidence, true);
    assert.deepEqual(m.aisles, []);
  });

  it("departments group by name across runs; loners dropped", () => {
    const m = mergeIngestRuns([
      run({ departments: [{ name: "Produce", box: [0, 0, 10, 10] }] }),
      run({ departments: [
        { name: "produce", box: [0, 0, 20, 20] },
        { name: "Deli", box: [0, 0, 1, 1] },
      ] }),
    ]);
    assert.equal(m.departments.length, 1);
    assert.equal(m.departments[0]!.name, "Produce");
    assert.deepEqual(m.departments[0]!.box, [0, 0, 15, 15]);
  });

  it("entrances cluster by centre; kind by majority", () => {
    const m = mergeIngestRuns([
      run({ entrances: [
        { box: [0, 0, 10, 10], kind: "entrance" },
        { box: [800, 800, 810, 810], kind: "exit" },
      ] }),
      run({ entrances: [{ box: [2, 2, 12, 12], kind: "both" }] }),
      run({ entrances: [{ box: [1, 1, 11, 11], kind: "entrance" }] }),
    ]);
    assert.equal(m.entrances.length, 1);
    assert.equal(m.entrances[0]!.kind, "entrance");
    assert.equal(m.entrances[0]!.agreement, 3);
  });
});

describe("combineIngestViews", () => {
  const merged = (over: Partial<MergedIngest> = {}): MergedIngest => ({
    runsOk: 3,
    lowConfidence: false,
    aisles: [],
    departments: [],
    entrances: [],
    notes: [],
    ...over,
  });
  const aisle = (
    n: string,
    orientation: "vertical" | "horizontal",
    items: string[],
  ): MergedIngest["aisles"][number] => ({
    n,
    orientation,
    box: [0, 0, 10, 100],
    items,
    agreement: 3,
  });

  it("vertical aisles take items from the rotated merge, matched by n", () => {
    const out = combineIngestViews(
      merged({ aisles: [aisle("3", "vertical", ["orig-item"])] }),
      merged({ aisles: [aisle("3", "horizontal", ["rot-a", "rot-b"])] }),
    );
    assert.deepEqual(out.aisles[0]!.items, ["rot-a", "rot-b"]);
    assert.equal(out.aisles[0]!.itemsView, "rotated");
    // geometry/orientation stay original
    assert.equal(out.aisles[0]!.orientation, "vertical");
    assert.deepEqual(out.aisles[0]!.box, [0, 0, 10, 100]);
    assert.equal(out.runsOk, 6);
  });

  it("horizontal aisles keep original items", () => {
    const out = combineIngestViews(
      merged({ aisles: [aisle("21", "horizontal", ["orig-item"])] }),
      merged({ aisles: [aisle("21", "vertical", ["rot-item"])] }),
    );
    assert.deepEqual(out.aisles[0]!.items, ["orig-item"]);
    assert.equal(out.aisles[0]!.itemsView, "original");
  });

  it("vertical aisle missing from rotated merge keeps original items", () => {
    const out = combineIngestViews(
      merged({ aisles: [aisle("7", "vertical", ["orig-item"])] }),
      merged({ aisles: [aisle("8", "horizontal", ["other"])] }),
    );
    assert.deepEqual(out.aisles[0]!.items, ["orig-item"]);
    assert.equal(out.aisles[0]!.itemsView, "original");
    assert.ok(!out.notes.includes(ROTATED_FALLBACK_NOTE));
  });

  it("empty rotated side returns original items plus a note", () => {
    for (const rot of [null, merged({ runsOk: 0, lowConfidence: true })]) {
      const out = combineIngestViews(
        merged({
          aisles: [aisle("3", "vertical", ["orig-item"])],
          notes: ["orig-note"],
        }),
        rot,
      );
      assert.deepEqual(out.aisles[0]!.items, ["orig-item"]);
      assert.equal(out.aisles[0]!.itemsView, "original");
      assert.deepEqual(out.notes, ["orig-note", ROTATED_FALLBACK_NOTE]);
      assert.equal(out.runsOk, 3);
    }
  });
});

describe("capMergedIngest", () => {
  it("caps aisles, items per aisle, total items, and string length", () => {
    const m = capMergedIngest({
      runsOk: 3,
      lowConfidence: false,
      aisles: Array.from({ length: 61 }, (_, i) => ({
        n: `n${i}-` + "y".repeat(70),
        orientation: "vertical" as const,
        box: [0, 0, 1, 1] as [number, number, number, number],
        items: Array.from({ length: 41 }, (_, j) => `item${i}-${j}-` + "z".repeat(70)),
        agreement: 3,
      })),
      departments: [{ name: "d".repeat(70), box: [0, 0, 1, 1], agreement: 2 }],
      entrances: [],
      notes: ["n".repeat(70)],
    });
    assert.equal(m.aisles.length, 60);
    assert.ok(m.aisles.every((a) => a.items.length <= 40));
    const total = m.aisles.reduce((s, a) => s + a.items.length, 0);
    assert.ok(total <= 800);
    assert.ok(m.aisles[0]!.n.length <= 60);
    assert.ok(m.aisles[0]!.items[0]!.length <= 60);
    assert.ok(m.departments[0]!.name.length <= 60);
    assert.ok(m.notes[0]!.length <= 60);
  });
});
