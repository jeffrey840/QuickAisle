import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildStoreFromDraft, type DraftInput } from "@quickaisle/routing";
import {
  createStoreRepo,
  HEB_ID,
  newStoreId,
  type KV,
  type SavedStore,
} from "./stores.ts";

function fakeKV(): KV & { dump: () => Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
    removeItem: async (k) => {
      m.delete(k);
    },
    dump: () => Object.fromEntries(m),
  };
}

const draft = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../data/stores/store-002/draft-ingest-v1.json"), "utf8"),
) as DraftInput;

function sample(id: string, name: string): SavedStore {
  const { store } = buildStoreFromDraft(draft, { storeId: id, imageSize: [1662, 1064] });
  return {
    id,
    name,
    createdAt: new Date().toISOString(),
    imageSize: [1662, 1064],
    mapDataUri: "data:image/jpeg;base64,AAA",
    draft: { ...draft, notes: [], lowConfidence: false },
    store,
  };
}

describe("store repo", () => {
  it("save → list → get → remove round-trips", async () => {
    const repo = createStoreRepo(fakeKV());
    assert.deepEqual(await repo.list(), []);
    const s = sample(newStoreId(), "Second store");
    await repo.save(s);
    assert.equal((await repo.list()).length, 1);
    assert.equal((await repo.get(s.id))?.name, "Second store");
    await repo.remove(s.id);
    assert.deepEqual(await repo.list(), []);
    assert.equal(await repo.get(s.id), null);
  });

  it("refuses to save over or delete the built-in H-E-B", async () => {
    const repo = createStoreRepo(fakeKV());
    await assert.rejects(repo.save(sample(HEB_ID, "x")), /built-in/);
    await assert.rejects(repo.remove(HEB_ID), /built-in/);
  });

  it("selection defaults to heb-001 and resets on delete", async () => {
    const repo = createStoreRepo(fakeKV());
    assert.equal(await repo.selected(), HEB_ID);
    const s = sample(newStoreId(), "Second store");
    await repo.save(s);
    await repo.select(s.id);
    assert.equal(await repo.selected(), s.id);
    await repo.remove(s.id);
    assert.equal(await repo.selected(), HEB_ID);
  });

  it("skips corrupt entries instead of throwing", async () => {
    const kv = fakeKV();
    await kv.setItem("quickaisle:stores", JSON.stringify({ a: { id: "a", junk: 1 } }));
    const repo = createStoreRepo(kv);
    assert.deepEqual(await repo.list(), []);
    await kv.setItem("quickaisle:stores", "not json{{{");
    assert.deepEqual(await repo.list(), []);
  });

  it("newStoreId makes unique ids", () => {
    assert.notEqual(newStoreId(), newStoreId());
  });

  it("stores one key per store plus a small index", async () => {
    const kv = fakeKV();
    const repo = createStoreRepo(kv);
    const s = sample(newStoreId(), "Second store");
    await repo.save(s);
    const dump = kv.dump();
    assert.ok(`quickaisle:store:${s.id}` in dump);
    assert.deepEqual(JSON.parse(dump["quickaisle:stores:index"]!), [s.id]);
    assert.ok(!("quickaisle:stores" in dump));
  });

  it("delete removes the store key and the index entry", async () => {
    const kv = fakeKV();
    const repo = createStoreRepo(kv);
    const a = sample(newStoreId(), "A");
    const b = sample(newStoreId(), "B");
    await repo.save(a);
    await repo.save(b);
    await repo.remove(a.id);
    const dump = kv.dump();
    assert.deepEqual(JSON.parse(dump["quickaisle:stores:index"]!), [b.id]);
    assert.ok(!(`quickaisle:store:${a.id}` in dump));
    assert.deepEqual((await repo.list()).map((s) => s.id), [b.id]);
  });

  it("migrates the old single key once, then removes it", async () => {
    const kv = fakeKV();
    const s = sample(newStoreId(), "Legacy store");
    await kv.setItem("quickaisle:stores", JSON.stringify({ [s.id]: s, bad: { id: "bad" } }));
    const repo = createStoreRepo(kv);
    assert.deepEqual((await repo.list()).map((x) => x.id), [s.id]);
    const dump = kv.dump();
    assert.ok(!("quickaisle:stores" in dump));
    assert.ok(`quickaisle:store:${s.id}` in dump);
    assert.deepEqual(JSON.parse(dump["quickaisle:stores:index"]!), [s.id]);
    // second access is a no-op, not a duplicate
    assert.equal((await repo.list()).length, 1);
  });
});
