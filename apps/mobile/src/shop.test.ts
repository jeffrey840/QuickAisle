import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { current, isDone, markGot, markSkipped, startShop, summarize } from "./shop.ts";

const stops = [
  { label: "Aisle 3 — Cereal", name: "Cereal" },
  { label: "Aisle 7 — Pickles", name: "Pickles" },
  { label: "Dairy wall — Milk", name: "Milk" },
];

describe("shop", () => {
  it("walks stops in order with got/skip/progress counts", () => {
    let s = startShop(stops);
    assert.deepEqual(current(s), { stop: stops[0], position: 1, total: 3 });
    s = markGot(s);
    assert.deepEqual(current(s)?.position, 2);
    s = markSkipped(s);
    assert.deepEqual(current(s)?.position, 3);
    assert.equal(isDone(s), false);
    s = markGot(s);
    assert.equal(isDone(s), true);
    assert.equal(current(s), null);
  });

  it("end summary lists got count and skipped item names", () => {
    let s = startShop(stops);
    s = markGot(s);
    s = markSkipped(s);
    s = markGot(s);
    assert.deepEqual(summarize(s), { got: 2, skipped: 1, skippedNames: ["Pickles"] });
  });

  it("marking past the end is a no-op", () => {
    let s = startShop(stops.slice(0, 1));
    s = markGot(s);
    assert.deepEqual(summarize(markGot(s)), { got: 1, skipped: 0, skippedNames: [] });
    assert.deepEqual(summarize(markSkipped(s)), { got: 1, skipped: 0, skippedNames: [] });
  });
});
