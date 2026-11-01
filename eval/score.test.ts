import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normT4Item,
  scoreT1,
  scoreT2,
  scoreT3Case,
  scoreT4List,
  scoreT4Run,
  t4LenientHit,
} from "./score.ts";

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
    assert.equal(s.rowAccuracy, 0);
    assert.deepEqual(s.extras, ["Unicorn Steak"]);
    assert.equal(s.missing.length, 3);
    assert.equal(s.mismatches.length, 4);
  });
  it("excludes known conflicts from denominators and failures", () => {
    const s = scoreT1(
      gold,
      [
        { name: "Cereal", aisle: "3" },
        { name: "Q-Tips", aisle: "14" },
        { name: "Batteries", aisle: "End Cap" },
        { name: "Rice", aisle: "6" },
      ],
      ["Rice"],
    );
    assert.equal(s.total, 3);
    assert.equal(s.rowAccuracy, 1);
    assert.equal(s.mismatches.length, 0);
    assert.equal(s.conflicts.length, 1);
    assert.equal(s.conflicts[0]!.name, "Rice");
    assert.equal(s.conflicts[0]!.gotAisle, "6");
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

describe("normT4Item", () => {
  it("lowercases, strips leading -/| and trailing ./,, collapses spaces", () => {
    assert.equal(normT4Item("  - Tortillas. "), "tortillas");
    assert.equal(normT4Item("|Eggs,"), "eggs");
    assert.equal(normT4Item("PB  &  J   stuff"), "pb & j stuff");
    assert.equal(normT4Item("2 Doz Eggs"), "2 doz eggs");
  });
});

describe("scoreT4List", () => {
  const list06 = {
    items: ["apples", "cheese -> shredded", "razors", "pickles", "sushi"],
    mustNotReturn: ["grapes"],
    notes: ["check price"],
  };

  it("scores a perfect list at recall 1 with no extras", () => {
    const s = scoreT4List("list-06.jpg", list06, [
      { text: "apples" },
      { text: "cheese -> shredded" },
      { text: "razors" },
      { text: "pickles" },
      { text: "sushi" },
    ]);
    assert.equal(s.matched, 5);
    assert.equal(s.recall, 1);
    assert.deepEqual(s.falseItems, []);
    assert.deepEqual(s.mustNotHits, []);
    assert.deepEqual(s.noteLeaks, []);
    assert.deepEqual(s.missing, []);
  });

  it("crossed-out item returned counts as a mustNotReturn hit, not a false item", () => {
    const s = scoreT4List("list-06.jpg", list06, [{ text: "apples" }, { text: "grapes" }]);
    assert.deepEqual(s.mustNotHits, ["grapes"]);
    assert.deepEqual(s.falseItems, []);
    assert.equal(s.matched, 1);
  });

  it("returned heading counts as a mustNotReturn hit", () => {
    const s = scoreT4List(
      "list-08.jpg",
      {
        items: ["tortillas", "salsa"],
        mustNotReturn: ["TACO NIGHT"],
        notes: [],
      },
      [{ text: "TACO NIGHT" }, { text: "- tortillas." }, { text: "salsa" }],
    );
    assert.deepEqual(s.mustNotHits, ["TACO NIGHT"]);
    assert.equal(s.matched, 2);
    assert.equal(s.recall, 1);
  });

  it("note smuggled with an item counts as matched plus a note leak", () => {
    const s = scoreT4List("list-06.jpg", list06, [{ text: "pickles <- check price" }]);
    assert.equal(s.matched, 1);
    assert.deepEqual(s.missing.filter((m) => m === "pickles"), []);
    assert.deepEqual(s.noteLeaks, ["pickles <- check price"]);
    assert.deepEqual(s.falseItems, []);
  });

  it("ice matches but ice cream is a mustNotReturn hit (list-10)", () => {
    const s = scoreT4List(
      "list-10.jpg",
      { items: ["ice", "rice"], mustNotReturn: ["ice cream", "coffee"], notes: [] },
      [{ text: "ice" }, { text: "ice cream" }],
    );
    assert.equal(s.matched, 1);
    assert.deepEqual(s.mustNotHits, ["ice cream"]);
    assert.deepEqual(s.falseItems, []);
  });

  it("duplicate returns count once; unknown strings are false items", () => {
    const s = scoreT4List(
      "list-06.jpg",
      list06,
      [{ text: "apples" }, { text: "apples" }, { text: "unicorn" }],
    );
    assert.equal(s.matched, 1);
    assert.deepEqual(s.falseItems, ["apples", "unicorn"]);
    assert.deepEqual(s.missing.sort(), ["cheese -> shredded", "pickles", "razors", "sushi"]);
  });

  it("split quantity matches either order; quantity already in text needs no combo", () => {
    const gold = { items: ["2 doz eggs", "Cheerios x2"], mustNotReturn: [], notes: [] };
    const split = scoreT4List("list-03.jpg", gold, [
      { text: "eggs", quantity: "2 doz" },
      { text: "Cheerios", quantity: "x2" },
    ]);
    assert.equal(split.matched, 2);
    assert.equal(split.recall, 1);
    assert.deepEqual(split.falseItems, []);
    const whole = scoreT4List("list-03.jpg", gold, [
      { text: "2 doz eggs", quantity: "2 doz" },
      { text: "Cheerios x2", quantity: "" },
    ]);
    assert.equal(whole.matched, 2);
    assert.deepEqual(whole.falseItems, []);
  });
});

describe("t4LenientHit", () => {
  it("credits transcription wobble but not real misses", () => {
    assert.equal(t4LenientHit("Cheerios ×2", "Cheerios x2"), true);
    assert.equal(t4LenientHit("2 dozen eggs", "2 doz eggs"), false);
    assert.equal(t4LenientHit("tortillas", "tortilla"), true);
    assert.equal(t4LenientHit("", "eggs"), false);
    assert.equal(t4LenientHit("eggs", ""), false);
  });

  it("flows into lenientMatched but strict stays exact", () => {
    const s = scoreT4List(
      "list-03.jpg",
      { items: ["Cheerios x2", "2 doz eggs"], mustNotReturn: [], notes: [] },
      [{ text: "Cheerios ×2" }, { text: "2 dozen eggs" }],
    );
    assert.equal(s.matched, 0);
    assert.equal(s.lenientMatched, 1);
  });

  it("a mustNot hit never credits lenient recall", () => {
    const s = scoreT4List(
      "list-10.jpg",
      { items: ["ice"], mustNotReturn: ["ice cream"], notes: [] },
      [{ text: "ice cream" }],
    );
    assert.deepEqual(s.mustNotHits, ["ice cream"]);
    assert.equal(s.lenientMatched, 0);
  });
});

describe("scoreT4Run", () => {
  it("micro-recall counts timeouts as failed lists, never skipped", () => {
    const ok = scoreT4List("a.jpg", { items: ["x", "y"], mustNotReturn: [], notes: [] }, [{ text: "x" }]);
    const failed = scoreT4List("b.jpg", { items: ["p", "q"], mustNotReturn: [], notes: [] }, []);
    const s = scoreT4Run([
      { image: "a.jpg", score: ok, ms: 8000, timeout: false },
      { image: "b.jpg", score: failed, ms: 45000, timeout: true },
    ]);
    assert.equal(s.lists, 2);
    assert.equal(s.failed, 1);
    assert.equal(s.timeouts, 1);
    assert.equal(s.recall, 1 / 4);
    // p50 mirrors eval/run.ts aggregate(): index floor(0.5*n) → 45000 for n=2
    assert.equal(s.p50, 45000);
    assert.equal(s.max, 45000);
  });
});
