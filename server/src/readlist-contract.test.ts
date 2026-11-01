import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { READLIST_PROMPT, ReadListSchema } from "./readlist-contract.ts";

describe("readlist contract", () => {
  it("parses items + notes, quantity optional", () => {
    const v = ReadListSchema.safeParse({
      items: [{ text: "cerial", quantity: "2" }, { text: "TP" }],
      notes: ["check price"],
    });
    assert.equal(v.success, true);
  });

  it("rejects non-string items", () => {
    assert.equal(
      ReadListSchema.safeParse({ items: [{ text: 42 }], notes: [] }).success,
      false,
    );
  });

  it("readlist-v1 demands verbatim transcription and skip rules", () => {
    assert.equal(READLIST_PROMPT.version, "readlist-v1");
    assert.ok(READLIST_PROMPT.user.includes("VERBATIM"));
    assert.ok(READLIST_PROMPT.user.includes("SKIP crossed-out"));
    assert.ok(READLIST_PROMPT.user.includes("Never add items"));
  });
});
