import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StoreDoc, type StoreProduct } from "@quickaisle/schema";
import {
  normalize,
  resolveListExact,
  resolveLocal,
  type AliasStore,
  type LearnedAlias,
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

const TEST_A = "prescriptions, eggs, apples, cereal, cheese, chicken, razors";
const TEST_B = "cookies, pickles, water, sushi, frozen food";
const parseList = (raw: string): string[] =>
  raw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);

function memStore(): AliasStore & { map: Map<string, LearnedAlias> } {
  const map = new Map<string, LearnedAlias>();
  return {
    map,
    get: async (_storeId, term) => map.get(term) ?? null,
    save: async (_storeId, term, productId, confidence) => {
      map.set(term, { productId, confidence, ts: Date.now() });
    },
  };
}

describe("resolveLocal", () => {
  for (const [name, list] of [["Test A", TEST_A], ["Test B", TEST_B]] as const) {
    it(`${name}: matches exactly what resolveListExact matches (offline parity)`, async () => {
      const terms = parseList(list);
      const before = resolveListExact(terms, products);
      assert.deepEqual(before.unmatched, [], "demo list must fully match today");
      const after = await resolveLocal(terms, products);
      assert.deepEqual(
        after.matched.map((m) => m.productId),
        before.matched.map((m) => m.productId),
      );
      assert.deepEqual(after.needAi, []);
    });
  }

  it("consults learned aliases before fuzzy", async () => {
    const cerealId = products.find((p) => p.name === "Cereal")!.id;
    const aliases = memStore();
    await aliases.save("heb-001", normalize("cerial"), cerealId, 0.95);
    const r = await resolveLocal(["cerial"], products, {
      storeId: "heb-001",
      aliases,
    });
    assert.deepEqual(r.matched, [{ term: "cerial", productId: cerealId, via: "alias" }]);
    assert.deepEqual(r.needAi, []);
  });

  it("ignores learned aliases whose productId left the catalog", async () => {
    const aliases = memStore();
    await aliases.save("heb-001", normalize("cerial"), "gone", 0.95);
    const r = await resolveLocal(["cerial"], products, {
      storeId: "heb-001",
      aliases,
    });
    assert.deepEqual(r.matched, []);
    assert.equal(r.needAi.length, 1);
    assert.equal(r.needAi[0]!.suggestions[0]!.name, "Cereal");
  });

  it("fuzzy-accepts clear misspellings without aliases", async () => {
    const r = await resolveLocal(["bananna"], products);
    assert.equal(r.matched.length, 1);
    assert.equal(r.matched[0]!.via, "fuzzy");
    assert.deepEqual(r.needAi, []);
  });

  it("skips terms that normalize to empty", async () => {
    const r = await resolveLocal(["   ", "!!!"], products);
    assert.deepEqual(r, { matched: [], needAi: [] });
  });
});
