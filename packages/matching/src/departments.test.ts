import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { StoreProduct } from "@quickaisle/schema";
import { departmentFallback } from "./index.ts";

const prod = (id: string, name: string, aliases: string[] = []): StoreProduct => ({
  id,
  name,
  aliases,
  locations: ["loc-0"],
  tags: [],
});

const dairy = prod("dairy", "Dairy");
const vinegar = prod("vinegar", "Vinegar");

describe("departmentFallback", () => {
  it("routes eggs to the Dairy department (the phone-test case)", () => {
    assert.equal(departmentFallback("eggs", [vinegar, dairy])?.id, "dairy");
  });

  it("is case-insensitive: Milk → Dairy", () => {
    assert.equal(departmentFallback("Milk", [dairy])?.id, "dairy");
  });

  it("routes ice cream to Frozen via name-contains", () => {
    const frozen = prod("frozen", "Frozen Foods");
    assert.equal(departmentFallback("ice cream", [frozen])?.id, "frozen");
  });

  it("returns null when the store has no matching department", () => {
    assert.equal(departmentFallback("eggs", [vinegar]), null);
    assert.equal(departmentFallback("unicorn steak", [dairy]), null);
    assert.equal(departmentFallback("   ", [dairy]), null);
  });

  it("never overrides a term the store sells directly", () => {
    const milk = prod("milk", "Milk");
    assert.equal(departmentFallback("milk", [milk, dairy]), null);
    const leche = prod("leche", "Leche", ["milk"]);
    assert.equal(departmentFallback("milk", [leche, dairy]), null);
  });

  it("prefers Tortilleria for tortillas, Bakery as backup", () => {
    const tortilleria = prod("tort", "Tortilleria");
    const bakery = prod("bakery", "Bakery");
    assert.equal(departmentFallback("tortillas", [bakery, tortilleria])?.id, "tort");
    assert.equal(departmentFallback("tortillas", [bakery])?.id, "bakery");
  });

  it("prefers the Market department over Meat, and over Market Deli", () => {
    const market = prod("market", "Market");
    const meat = prod("meat", "Meat");
    const deliCounter = prod("mdeli", "Market Deli");
    assert.equal(departmentFallback("chicken", [deliCounter, meat, market])?.id, "market");
    assert.equal(departmentFallback("chicken", [meat])?.id, "meat");
  });

  it("matches -oes plurals via normalize (tomatoes/potatoes)", () => {
    const produce = prod("produce", "Produce");
    assert.equal(departmentFallback("tomatoes", [produce])?.id, "produce");
    assert.equal(departmentFallback("potatoes", [produce])?.id, "produce");
  });

  it("ignores negated departments: Non-Dairy is never Dairy", () => {
    const ps = [prod("nondairy", "Non-Dairy Beverages"), vinegar, prod("produce", "Produce")];
    assert.equal(departmentFallback("eggs", ps), null);
    assert.equal(departmentFallback("milk", [prod("n", "Non Dairy Case")]), null);
    assert.equal(departmentFallback("cheese", [prod("n", "NONDAIRY ITEMS")]), null);
  });

  it("still hits whole-word mentions: Dairy Case, Frozen Foods", () => {
    assert.equal(departmentFallback("eggs", [prod("case", "Dairy Case")])?.id, "case");
    assert.equal(departmentFallback("ice cream", [prod("frozen", "Frozen Foods")])?.id, "frozen");
  });
});
