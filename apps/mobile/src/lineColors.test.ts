import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { areaColor, areaLabel } from "./lineColors.ts";

describe("areaColor", () => {
  it("maps departments to their line colors, case-insensitive", () => {
    assert.equal(areaColor("Produce"), "#00C389");
    assert.equal(areaColor("FROZEN FOODS"), "#7FD3FF");
    assert.equal(areaColor("Dairy"), "#4DA3FF");
    assert.equal(areaColor("Market Deli"), "#B07CFF");
    assert.equal(areaColor("Rx"), "#FF9F43");
    assert.equal(areaColor("Aisle 4 — Coffee"), "#FF5B6E");
  });

  it("matches whole words only, plurals included", () => {
    assert.equal(areaColor("Canned Vegetables"), "#00C389");
    assert.equal(areaColor("eggs"), "#4DA3FF");
    assert.equal(areaColor("Eggplant"), "#FF5B6E");
    assert.equal(areaColor("Marx"), "#FF5B6E");
    assert.equal(areaColor("Coffee"), "#FF5B6E");
  });

  it("labels the legend the same way", () => {
    assert.equal(areaLabel("Produce"), "Produce");
    assert.equal(areaLabel("Dairy"), "Dairy");
    assert.equal(areaLabel("Deli"), "Market");
    assert.equal(areaLabel("Aisle 4 — Coffee"), "Aisle");
    assert.equal(areaLabel("Coffee"), "Aisle");
  });
});
