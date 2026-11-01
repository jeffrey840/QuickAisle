import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StoreDoc, type StoreProduct } from "@quickaisle/schema";
import {
  FUZZY_ACCEPT,
  FUZZY_GRAY,
  buildFuzzyIndex,
  fuzzyMatch,
} from "./index.ts";

const store = StoreDoc.parse(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../../data/stores/heb-001/store.json"),
      "utf8",
    ),
  ),
);
const products: StoreProduct[] = store.products;
const fuse = buildFuzzyIndex(products);

describe("fuzzyMatch", () => {
  for (
    const [term, want] of [
      ["mayo", "Mayonnaise"],
      ["pickle", "Pickles"],
      ["tortillas", "Tortillas"],
      ["pop tarts", "Pop Tarts"],
      ["band aids", "Band-Aids"],
      ["bananna", "Produce"],
    ] as const
  ) {
    it(`accepts "${term}" as ${want} (≥ ${FUZZY_ACCEPT})`, () => {
      const hits = fuzzyMatch(term, fuse);
      assert.ok(hits.length > 0, "expected at least one hit");
      assert.equal(hits[0]!.name, want);
      assert.ok(
        hits[0]!.similarity >= FUZZY_ACCEPT,
        `similarity ${hits[0]!.similarity}`,
      );
    });
  }

  it('holds "cerial" in the gray zone with Cereal on top (AI confirms)', () => {
    const hits = fuzzyMatch("cerial", fuse);
    assert.equal(hits[0]!.name, "Cereal");
    assert.ok(hits[0]!.similarity >= FUZZY_GRAY);
    assert.ok(hits[0]!.similarity < FUZZY_ACCEPT);
  });

  it("holds ambiguous/wrong top hits below accept so AI decides", () => {
    // jello ties Jam/Jelly vs Jell-O; tide/coke/toothpaste top hits are wrong.
    for (const term of ["jello", "qtips", "tide", "coke", "toothpaste", "leche"]) {
      const hits = fuzzyMatch(term, fuse);
      assert.ok(hits.length > 0, `${term}: expected hits`);
      assert.ok(
        hits[0]!.similarity < FUZZY_ACCEPT,
        `${term}: top ${hits[0]!.name} ${hits[0]!.similarity} must not accept`,
      );
    }
  });

  it("rejects near-miss and garbage to AI (< 0.6)", () => {
    // "tortilla chips" must NOT accept Tortillas (correct answer is Chips, via AI).
    for (const term of ["tortilla chips", "asdfgh", "unicorn steak", "taco night"]) {
      const hits = fuzzyMatch(term, fuse);
      if (hits.length > 0) {
        assert.ok(
          hits[0]!.similarity < FUZZY_GRAY,
          `${term}: top ${hits[0]!.name} ${hits[0]!.similarity} must reject`,
        );
      }
    }
  });

  it('breaks the "ice" tie (Ice/Juice/Rice) toward the exact text', () => {
    const hits = fuzzyMatch("ice", fuse);
    assert.equal(hits[0]!.name, "Ice");
    assert.equal(hits[0]!.similarity, 1);
  });

  it("returns at most `limit` hits and [] for empty terms", () => {
    assert.ok(fuzzyMatch("cheese", fuse, 2).length <= 2);
    assert.deepEqual(fuzzyMatch("   ", fuse), []);
  });
});
