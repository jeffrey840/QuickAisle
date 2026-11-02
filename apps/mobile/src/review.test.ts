import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alsoIn } from "./review.ts";

const aisles = [
  { key: "a0", n: "8", items: ["cookies", "crackers"] },
  { key: "a1", n: "15", items: ["cookies", "chips"] },
  { key: "a2", n: "3", items: ["water"] },
];

describe("alsoIn", () => {
  it("lists other aisles holding the item", () => {
    assert.deepEqual(alsoIn("cookies", aisles, "a0"), ["15"]);
    assert.deepEqual(alsoIn("cookies", aisles, "a1"), ["8"]);
  });

  it("is empty for single-aisle items", () => {
    assert.deepEqual(alsoIn("water", aisles, "a2"), []);
    assert.deepEqual(alsoIn("nope", aisles, "a0"), []);
  });
});
