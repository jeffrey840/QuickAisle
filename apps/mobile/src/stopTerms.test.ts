import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addCardTerm, buildTermsById, termsSuffix } from "./stopTerms.ts";

describe("buildTermsById", () => {
  it("groups terms per product in list order without dupes", () => {
    assert.deepEqual(
      buildTermsById([
        { term: "eggs", productId: "dairy" },
        { term: "milk", productId: "dairy" },
        { term: "eggs", productId: "dairy" },
        { term: "coffee", productId: "coffee" },
      ]),
      { dairy: ["eggs", "milk"], coffee: ["coffee"] },
    );
  });
});

describe("termsSuffix", () => {
  it("shows merged terms but never repeats the product name", () => {
    assert.equal(termsSuffix("dairy", "Dairy", { dairy: ["eggs", "milk"] }), " — eggs, milk");
    assert.equal(termsSuffix("coffee", "Coffee", { coffee: ["coffee"] }), "");
    assert.equal(termsSuffix("dairy", "Dairy", { dairy: ["Dairy"] }), "");
    assert.equal(termsSuffix("dairy", "Dairy", {}), "");
  });
});

describe("addCardTerm", () => {
  it("appends a picked card term once", () => {
    const once = addCardTerm({ dairy: ["eggs"] }, "dairy", "milk");
    assert.deepEqual(once, { dairy: ["eggs", "milk"] });
    assert.deepEqual(addCardTerm(once, "dairy", "milk"), { dairy: ["eggs", "milk"] });
    assert.deepEqual(addCardTerm({}, "deli", "ham"), { deli: ["ham"] });
  });
});
