import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreT1, scoreT2, scoreT3Case } from "./score.ts";

describe("scoreT1", () => {
  const gold = [
    { name: "Cereal", aisle: "3" },
    { name: "Q-Tips", aisle: "14" },
    { name: "Batteries", aisle: "End Cap" },
    { name: "Rice", aisle: "4" },
  ];
  it("perfect answer scores 1.0", () => {
    const s = scoreT1(gold, [...gold]);
    assert.equal(s.recall, 1);
    assert.equal(s.aisleAccuracy, 1);
    assert.deepEqual(s.extras, []);
  });
  it("normalizes names and aisles", () => {
    const s = scoreT1(gold, [
      { name: "cereal", aisle: "3" },
      { name: "Q Tips", aisle: "14" },
      { name: "Batteries", aisle: "endcap" },
      { name: "Rice", aisle: "4" },
    ]);
    assert.equal(s.recall, 1);
    assert.equal(s.aisleAccuracy, 1);
  });
  it("counts missing, wrong-aisle, and extras", () => {
    const s = scoreT1(gold, [
      { name: "Cereal", aisle: "9" },
      { name: "Unicorn Steak", aisle: "1" },
    ]);
    assert.equal(s.found, 1);
    assert.equal(s.recall, 0.25);
    assert.equal(s.aisleAccuracy, 0);
    assert.deepEqual(s.extras, ["Unicorn Steak"]);
    assert.equal(s.missing.length, 3);
  });
});

describe("scoreT2", () => {
  const perfect = {
    aisles: Object.entries({
      1: 327, 2: 380, 3: 427, 4: 476, 5: 521, 6: 572, 7: 622, 8: 671,
      9: 723, 10: 773, 11: 815, 12: 865, 13: 910, 14: 962, 15: 1015,
      16: 1097, 17: 1172,
    }).map(([n, x]) => ({ n: Number(n), x })),
    departments: [
      { name: "Produce", xy: [250, 470] as [number, number] },
      { name: "Bakery", xy: [365, 110] as [number, number] },
      { name: "Market Deli", xy: [580, 210] as [number, number] },
      { name: "Sushi", xy: [778, 212] as [number, number] },
      { name: "Seafood", xy: [775, 140] as [number, number] },
      { name: "Market", xy: [965, 175] as [number, number] },
      { name: "Milk", xy: [1155, 95] as [number, number] },
      { name: "Eggs", xy: [1182, 180] as [number, number] },
      { name: "Dairy", xy: [1182, 330] as [number, number] },
      { name: "Frozen Foods", xy: [1097, 445] as [number, number] },
      { name: "Deli", xy: [265, 875] as [number, number] },
      { name: "Pharmacy", xy: [1140, 840] as [number, number] },
      { name: "Floral", xy: [395, 750] as [number, number] },
      { name: "Checkstands", xy: [660, 745] as [number, number] },
    ],
    entrances: [{ xy: [387, 925] as [number, number] }, { xy: [598, 930] as [number, number] }],
  };
  it("perfect layout scores full marks", () => {
    const s = scoreT2(perfect);
    assert.equal(s.aisleCountOk, true);
    assert.equal(s.orderOk, true);
    assert.equal(s.meanXErrorPx, 0);
    assert.equal(s.deptsFound, 14);
    assert.equal(s.entrancesFound, 2);
  });
  it("catches wrong order and position error", () => {
    const swapped = {
      ...perfect,
      aisles: perfect.aisles.map((a) => (a.n === 1 ? { ...a, x: 2000 } : a)),
    };
    const s = scoreT2(swapped);
    assert.equal(s.orderOk, false);
    assert.ok(s.meanXErrorPx > 50);
  });
});

describe("scoreT3Case", () => {
  it("any_of matches top-1", () => {
    assert.equal(
      scoreT3Case({ any_of: ["Cereal"] }, { topNames: ["Cereal"], needsClarification: false, invented: [] }).correct,
      true,
    );
    assert.equal(
      scoreT3Case({ any_of: ["Cereal"] }, { topNames: ["Soup"], needsClarification: false, invented: [] }).correct,
      false,
    );
  });
  it("clarify requires asking", () => {
    assert.equal(
      scoreT3Case(
        { clarify: true, options_any_of: ["Dairy", "Deli"] },
        { topNames: [], needsClarification: true, invented: [] },
      ).correct,
      true,
    );
    assert.equal(
      scoreT3Case(
        { clarify: true, options_any_of: ["Dairy", "Deli"] },
        { topNames: ["Dairy"], needsClarification: false, invented: [] },
      ).correct,
      false,
    );
  });
  it("expansion needs every group covered", () => {
    assert.equal(
      scoreT3Case(
        { expand_includes: [["Tortillas"], ["Salsa", "Picante Sauce"]] },
        { topNames: ["Tortillas", "Picante Sauce"], needsClarification: false, invented: [] },
      ).correct,
      true,
    );
    assert.equal(
      scoreT3Case(
        { expand_includes: [["Tortillas"], ["Salsa", "Picante Sauce"]] },
        { topNames: ["Tortillas"], needsClarification: false, invented: [] },
      ).correct,
      false,
    );
  });
  it("none rejects any match", () => {
    assert.equal(
      scoreT3Case({ none: true }, { topNames: [], needsClarification: false, invented: [] }).correct,
      true,
    );
    assert.equal(
      scoreT3Case({ none: true }, { topNames: ["Auto Supplies"], needsClarification: false, invented: [] }).correct,
      false,
    );
  });
});
