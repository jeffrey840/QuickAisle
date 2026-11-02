import { describe, it } from "node:test";
import assert from "node:assert/strict";
import app from "./index.ts";
import {
  MAX_BODY_CHARS,
  MAX_MAP_BYTES,
  IngestError,
  handleIngestText,
  validateIngestRequest,
} from "./ingest.ts";
import { IngestSchema } from "./ingest-contract.ts";
import type { chat } from "./providers/index.ts";
import type { IngestData } from "./ingest-contract.ts";

const img = (over: Record<string, unknown> = {}) => ({
  image: { mime: "image/png", b64: "aGVsbG8=", ...over },
});

const oneAisle = (n: string): IngestData => ({
  aisles: [{ n, orientation: "vertical", box: [0, 0, 1, 10], items: ["Milk"] }],
  departments: [],
  entrances: [],
  notes: [],
});

function fakeChat(
  behavior: "ok" | "fail" | "hang",
  data?: IngestData,
): typeof chat {
  return (async () => {
    if (behavior === "fail") throw new Error("meta 500");
    if (behavior === "hang") await new Promise(() => {});
    return {
      data: data ?? oneAisle("13"),
      raw: "{}",
      provider: "meta",
      latencyMs: 5,
      retries: 0,
    };
  }) as unknown as typeof chat;
}

describe("validateIngestRequest", () => {
  it("accepts jpeg/png only", () => {
    assert.equal(validateIngestRequest(img()).mime, "image/png");
    assert.equal(validateIngestRequest(img({ mime: "image/jpeg" })).mime, "image/jpeg");
    for (const mime of ["image/webp", "image/gif"]) {
      assert.throws(() => validateIngestRequest(img({ mime })), (e: unknown) => {
        assert.ok(e instanceof IngestError && e.status === 400);
        return true;
      });
    }
  });

  it("missing/empty/invalid b64 → 400", () => {
    for (const body of [{}, { image: {} }, img({ b64: "" }), img({ b64: "!!!" })]) {
      assert.throws(() => validateIngestRequest(body), (e: unknown) => {
        assert.ok(e instanceof IngestError && e.status === 400);
        return true;
      });
    }
  });

  it("oversize image → 413", () => {
    const big = "A".repeat(Math.ceil((MAX_MAP_BYTES * 4) / 3) + 8);
    assert.throws(() => validateIngestRequest(img({ b64: big })), (e: unknown) => {
      assert.ok(e instanceof IngestError && e.status === 413);
      assert.ok((e as Error).message.includes("3 MB"));
      return true;
    });
  });
});

describe("POST /ingest", () => {
  it("rejects oversized bodies before parsing", async () => {
    const res = await app.request(
      "http://x/ingest",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(MAX_BODY_CHARS + 1) },
      {},
    );
    assert.equal(res.status, 413);
    assert.ok(((await res.json()) as { error: string }).error.includes("too large"));
  });

  it("non-JSON body → 400", async () => {
    const res = await app.request(
      "http://x/ingest",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "not json" },
      {},
    );
    assert.equal(res.status, 400);
  });
});

describe("handleIngestText", () => {
  it("merges 3 runs and reports meta", async () => {
    const out = await handleIngestText(JSON.stringify(img()), {}, fakeChat("ok"));
    assert.equal(out.status, 200);
    assert.equal(out.json.runsOk, 3);
    assert.equal(out.json.lowConfidence, false);
    assert.equal(out.json.provider, "meta");
    assert.deepEqual(out.json.aisles.map((a) => a.n), ["13"]);
    assert.ok(out.log.includes("runsOk=3"));
    assert.ok(!out.log.includes("aGVsbG8="));
  });

  it("all runs failing → 502 with the sharper-photo message", async () => {
    await assert.rejects(handleIngestText(JSON.stringify(img()), {}, fakeChat("fail")), (e: unknown) => {
      assert.ok(e instanceof IngestError && e.status === 502);
      assert.ok((e as Error).message.includes("sharper photo"));
      return true;
    });
  });

  it("whole-request timeout merges nothing and 502s fast", async () => {
    await assert.rejects(
      handleIngestText(JSON.stringify(img()), {}, fakeChat("hang"), 50),
      (e: unknown) => {
        assert.ok(e instanceof IngestError && e.status === 502);
        return true;
      },
    );
  });

  it("caps apply to merged output", async () => {
    const big: IngestData = {
      aisles: Array.from({ length: 61 }, (_, i) => ({
        n: String(i),
        orientation: "vertical",
        box: [0, 0, 1, 1],
        items: [],
      })),
      departments: [],
      entrances: [],
      notes: [],
    };
    const out = await handleIngestText(JSON.stringify(img()), {}, fakeChat("ok", big));
    assert.equal(out.json.aisles.length, 60);
  });
});

describe("IngestSchema", () => {
  it("rejects bad shapes", () => {
    const good = oneAisle("13A");
    assert.equal(IngestSchema.safeParse(good).success, true);
    assert.equal(IngestSchema.safeParse({ ...good, aisles: [] }).success, false);
    assert.equal(
      IngestSchema.safeParse({
        ...good,
        aisles: [{ n: "1", orientation: "diagonal", box: [0, 0, 1, 1], items: [] }],
      }).success,
      false,
    );
    assert.equal(
      IngestSchema.safeParse({
        ...good,
        aisles: [{ n: "1", orientation: "vertical", box: [0, 0, 1], items: [] }],
      }).success,
      false,
    );
  });
});
