import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitSpoken } from "./spoken.ts";

describe("splitSpoken", () => {
  it("splits on multi-word phrase matches", () => {
    assert.deepEqual(
      splitSpoken("eggs milk peanut butter frozen pizza", [
        "eggs",
        "milk",
        "peanut butter",
        "frozen pizza",
      ]),
      ["eggs", "milk", "peanut butter", "frozen pizza"],
    );
  });

  it("leaves punctuated text untouched", () => {
    assert.deepEqual(splitSpoken("eggs, milk", ["eggs", "milk"]), ["eggs, milk"]);
  });

  it("drops consecutive duplicates, keeps spoken plurals", () => {
    assert.deepEqual(splitSpoken("bacon bacon apples", ["bacon", "apple"]), ["bacon", "apples"]);
  });

  it("keeps unmatched runs together for fuzzy/AI matching", () => {
    assert.deepEqual(splitSpoken("chiken breast milk", ["milk", "chicken"]), [
      "chiken breast",
      "milk",
    ]);
  });

  it("treats 'and' as a separator", () => {
    assert.deepEqual(splitSpoken("apples and cheese", ["apple", "cheese"]), ["apples", "cheese"]);
  });
});
