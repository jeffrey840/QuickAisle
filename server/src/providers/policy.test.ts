import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chatBaseten, chatMeta, providerOrder } from "./index.ts";
import { fallbackReasonFor } from "./http.ts";

describe("providerOrder", () => {
  it("defaults to Meta first, Baseten second (vision tasks, eval fallback-test)", () => {
    for (const policy of [undefined, {}, { fallback: true }, { fallback: false }] as const) {
      const o = providerOrder(policy);
      assert.equal(o.first, chatMeta);
      assert.equal(o.second, chatBaseten);
      assert.equal(o.firstName, "meta");
      assert.equal(o.secondName, "baseten");
    }
  });

  it("/resolve policy puts Baseten first, Meta second", () => {
    const o = providerOrder({ primary: "baseten", authFallback: true, hedgeMs: 12_000 });
    assert.equal(o.first, chatBaseten);
    assert.equal(o.second, chatMeta);
    assert.equal(o.firstName, "baseten");
    assert.equal(o.secondName, "meta");
  });
});

describe("fallbackReasonFor", () => {
  it("names the failed primary, defaulting to meta", () => {
    assert.equal(fallbackReasonFor(new Error("x")), "meta error");
    assert.equal(fallbackReasonFor(new Error("x"), "baseten"), "baseten error");
  });
});
