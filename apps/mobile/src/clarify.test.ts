import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StoreDoc, type StoreProduct } from "@quickaisle/schema";
import { cardForTerm, mapOptionsToProducts, mergePick } from "./clarify.ts";

const store = StoreDoc.parse(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../../data/stores/heb-001/store.json"),
      "utf8",
    ),
  ),
);
const products: StoreProduct[] = store.products;
const idOf = (name: string): string => products.find((p) => p.name === name)!.id;

describe("mapOptionsToProducts", () => {
  it("maps known names, drops anything not in the catalog", () => {
    const out = mapOptionsToProducts(["Dairy", "Narnia", "Deli"], products);
    assert.deepEqual(out.map((o) => o.name), ["Dairy", "Deli"]);
    assert.equal(out[0]!.productId, idOf("Dairy"));
  });

  it("caps at 4 options and dedupes", () => {
    const out = mapOptionsToProducts(
      ["Dairy", "Deli", "dairy", "Produce", "Bakery", "Sushi"],
      products,
    );
    assert.equal(out.length, 4);
    assert.deepEqual(out.map((o) => o.name), ["Dairy", "Deli", "Produce", "Bakery"]);
  });
});

describe("cardForTerm", () => {
  it("builds an AI card from mapped options", () => {
    const card = cardForTerm(
      "cheese",
      { question: "Which cheese?", options: ["Dairy", "Deli"] },
      [],
      products,
    );
    assert.ok(card && card.kind === "ai");
    assert.equal(card.question, "Which cheese?");
    assert.deepEqual(card.options.map((o) => o.name), ["Dairy", "Deli"]);
  });

  it("falls back to the fuzzy suggestion when AI options map to nothing", () => {
    const card = cardForTerm(
      "cerial",
      { question: "Huh?", options: ["Narnia"] },
      [{ productId: idOf("Cereal"), name: "Cereal", similarity: 0.83 }],
      products,
    );
    assert.ok(card && card.kind === "suggest");
    assert.equal(card.question, "Did you mean Cereal?");
    assert.equal(card.similarity, 0.83);
  });

  it("returns null when there is nothing to ask", () => {
    assert.equal(cardForTerm("asdfgh", undefined, [], products), null);
    assert.equal(
      cardForTerm("asdfgh", { question: "?", options: ["Narnia"] }, [], products),
      null,
    );
  });
});

describe("mergePick", () => {
  it("appends a picked product for re-planning, no dupes", () => {
    assert.deepEqual(mergePick(["a", "b"], "c"), ["a", "b", "c"]);
    assert.deepEqual(mergePick(["a", "b"], "b"), ["a", "b"]);
  });
});
