import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_IMAGE_BYTES,
  ReadListError,
  cleanReadList,
  handleReadList,
  validateReadListRequest,
} from "./readlist.ts";
import type { chat } from "./providers/index.ts";

/** Fake chat(): captures args/policy, returns canned data. No network. */
function fakeChat(canned: {
  data: { items: Array<{ text: string; quantity?: string }>; notes: string[] };
  provider?: "meta" | "baseten";
  fallbackReason?: string;
}): { fn: typeof chat; seen: { args?: unknown; policy?: unknown } } {
  const seen: { args?: unknown; policy?: unknown } = {};
  const fn = (async (args: unknown, _env: unknown, _o: unknown, policy: unknown) => {
    seen.args = args;
    seen.policy = policy;
    return {
      data: canned.data,
      raw: "{}",
      provider: canned.provider ?? "meta",
      latencyMs: 5,
      retries: 0,
      ...(canned.fallbackReason ? { fallbackReason: canned.fallbackReason } : {}),
    };
  }) as unknown as typeof chat;
  return { fn, seen };
}

const img = (over: Record<string, unknown> = {}) => ({
  storeId: "heb-001",
  image: { mime: "image/jpeg", b64: "aGVsbG8=", ...over },
});

describe("validateReadListRequest", () => {
  it("accepts jpeg/png/webp", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
      assert.equal(validateReadListRequest(img({ mime })).mime, mime);
    }
  });

  it("bad mime → 400", () => {
    assert.throws(() => validateReadListRequest(img({ mime: "image/gif" })), (e: unknown) => {
      assert.ok(e instanceof ReadListError && e.status === 400);
      return true;
    });
  });

  it("missing/empty/invalid b64 → 400", () => {
    for (const b64 of ["", "   ", "!!!not-base64!!!"]) {
      assert.throws(() => validateReadListRequest(img({ b64 })), (e: unknown) => {
        assert.ok(e instanceof ReadListError && e.status === 400);
        return true;
      });
    }
    assert.throws(() => validateReadListRequest({ storeId: "x" }), (e: unknown) => {
      assert.ok(e instanceof ReadListError && e.status === 400);
      return true;
    });
  });

  it("oversize image → 413", () => {
    const big = "A".repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8);
    assert.throws(() => validateReadListRequest(img({ b64: big })), (e: unknown) => {
      assert.ok(e instanceof ReadListError && e.status === 413);
      assert.ok((e as Error).message.includes("1.5 MB"));
      return true;
    });
  });
});

describe("cleanReadList", () => {
  it("trims, strips bullets/punct, drops empties, dedupes case-insensitively", () => {
    const { items, notes } = cleanReadList({
      items: [
        { text: "sushi." },
        { text: "- tortillas" },
        { text: "SUSHI" },
        { text: "   " },
        { text: "• eggs," },
      ],
      notes: [" check price ", ""],
    });
    assert.deepEqual(items.map((i) => i.text), ["sushi", "tortillas", "eggs"]);
    assert.deepEqual(notes, ["check price"]);
  });

  it("caps 30 items × 60 chars", () => {
    const { items } = cleanReadList({
      items: [
        ...Array.from({ length: 31 }, (_, i) => ({ text: `item ${i}` })),
        { text: "x".repeat(61) },
      ],
      notes: [],
    });
    assert.equal(items.length, 30);
    assert.ok(items.every((i) => i.text.length <= 60));
  });

  it("trims quantity, defaults missing to empty", () => {
    const { items } = cleanReadList({
      items: [{ text: "eggs", quantity: " 2 doz " }, { text: "milk" }],
      notes: [],
    });
    assert.deepEqual(items, [
      { text: "eggs", quantity: "2 doz" },
      { text: "milk", quantity: "" },
    ]);
  });
});

describe("handleReadList", () => {
  it("passes Meta-primary policy, 30s timeout, 8s hedge to chat()", async () => {
    const { fn, seen } = fakeChat({ data: { items: [{ text: "eggs" }], notes: [] } });
    const out = await handleReadList(img(), {}, fn);
    assert.equal(out.status, 200);
    const args = seen.args as { timeoutMs?: number; images?: unknown[] };
    const policy = seen.policy as Record<string, unknown>;
    assert.equal(args.timeoutMs, 30_000);
    assert.equal(Array.isArray(args.images), true);
    assert.deepEqual(policy, { primary: "meta", authFallback: true, hedgeMs: 8_000 });
    assert.deepEqual(out.json.items, [{ text: "eggs", quantity: "" }]);
    assert.equal(out.json.provider, "meta");
  });

  it("propagates fallback provider + reason (Meta timeout → Baseten used)", async () => {
    const { fn } = fakeChat({
      data: { items: [{ text: "eggs" }], notes: [] },
      provider: "baseten",
      fallbackReason: "meta timeout",
    });
    const out = await handleReadList(img(), {}, fn);
    assert.equal(out.json.provider, "baseten");
    assert.equal(out.json.fallbackReason, "meta timeout");
  });

  it("logs counts only, never image data", async () => {
    const b64 = "aGVsbG93b3JsZA==";
    const { fn } = fakeChat({ data: { items: [{ text: "eggs" }], notes: ["n"] } });
    const out = await handleReadList(img({ b64 }), {}, fn);
    assert.ok(!out.log.includes(b64));
    assert.ok(out.log.includes("items=1"));
  });
});
