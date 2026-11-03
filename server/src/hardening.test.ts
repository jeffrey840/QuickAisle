import { describe, it } from "node:test";
import assert from "node:assert/strict";
import app, { contentLengthOverCap, hasRotatedView } from "./index.ts";
import { RATE_LIMITS, dayKey, ipKey, type RateLimitKV } from "./ratelimit.ts";
import { MAX_RESOLVE_BODY_CHARS } from "./resolve.ts";
import { MAX_READLIST_BODY_CHARS } from "./readlist.ts";
import { MAX_BODY_CHARS } from "./ingest.ts";
import { MAX_VOICE_BODY_CHARS } from "./voice.ts";

class FakeKV implements RateLimitKV {
  map = new Map<string, string>();
  puts: Array<{ key: string; value: string }> = [];
  mode: "ok" | "throwGet" | "throwPut";
  constructor(mode: "ok" | "throwGet" | "throwPut" = "ok") {
    this.mode = mode;
  }
  async get(key: string): Promise<string | null> {
    if (this.mode === "throwGet") throw new Error("kv down");
    return this.map.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    if (this.mode === "throwPut") throw new Error("kv quota");
    this.puts.push({ key, value });
    this.map.set(key, value);
  }
}

const ROUTES: Array<{ path: string; cap: number }> = [
  { path: "/resolve", cap: MAX_RESOLVE_BODY_CHARS },
  { path: "/read-list", cap: MAX_READLIST_BODY_CHARS },
  { path: "/ingest", cap: MAX_BODY_CHARS },
  { path: "/voice-list", cap: MAX_VOICE_BODY_CHARS },
];

describe("contentLengthOverCap", () => {
  it("blocks only a present, numeric, over-cap length", () => {
    assert.equal(contentLengthOverCap(undefined, 100), false);
    assert.equal(contentLengthOverCap("garbage", 100), false);
    assert.equal(contentLengthOverCap("", 100), false);
    assert.equal(contentLengthOverCap("-5", 100), false);
    assert.equal(contentLengthOverCap("100", 100), false);
    assert.equal(contentLengthOverCap("101", 100), true);
    assert.equal(contentLengthOverCap(" 101 ", 100), true);
  });
});

describe("hasRotatedView", () => {
  it("detects the rotated key with any spacing, false when absent or invalid", () => {
    assert.equal(hasRotatedView('{"image":{},"rotated":{}}'), true);
    assert.equal(hasRotatedView('{ "image": {}, "rotated" : {} }'), true);
    assert.equal(hasRotatedView('{"image":{}}'), false);
    assert.equal(hasRotatedView("not json"), false);
  });
});

describe("pre-read Content-Length gate", () => {
  for (const { path, cap } of ROUTES) {
    it(`${path}: over-cap length → 413 without charging or handling`, async () => {
      const kv = new FakeKV();
      const res = await app.request(
        `http://x${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": String(cap + 1) },
          body: "{}",
        },
        { RATE_LIMIT: kv },
      );
      assert.equal(res.status, 413);
      assert.ok(((await res.json()) as { error: string }).error.includes("too large"));
      assert.deepEqual(kv.puts, []);
    });
  }
});

describe("after-read cap (lying Content-Length)", () => {
  for (const { path, cap } of ROUTES) {
    it(`${path}: small lying length + over-cap body → 413`, async () => {
      const res = await app.request(
        `http://x${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": "8" },
          body: "x".repeat(cap + 1),
        },
        {},
      );
      assert.equal(res.status, 413);
      assert.ok(((await res.json()) as { error: string }).error.includes("too large"));
    });
  }
});

describe("rate limiter", () => {
  it("per-IP hourly cap: 40 resolve units pass, 41st gets 429 + Retry-After", async () => {
    const kv = new FakeKV();
    const env = { RATE_LIMIT: kv };
    for (let i = 0; i < 40; i++) {
      const res = await app.request(
        "http://x/resolve",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        env,
      );
      assert.equal(res.status, 400); // charged, then validation rejects
    }
    const denied = await app.request(
      "http://x/resolve",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      env,
    );
    assert.equal(denied.status, 429);
    assert.equal(((await denied.json()) as { error: string }).error, RATE_LIMITS.message);
    const retry = Number(denied.headers.get("Retry-After"));
    assert.ok(Number.isFinite(retry) && retry > 0 && retry <= 3600, `Retry-After=${retry}`);
  });

  it("global daily cap: a full day bucket denies fresh IPs", async () => {
    const kv = new FakeKV();
    kv.map.set(dayKey(Date.now()), String(RATE_LIMITS.globalUnitsPerDay));
    const res = await app.request(
      "http://x/resolve",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      { RATE_LIMIT: kv },
    );
    assert.equal(res.status, 429);
    const retry = Number(res.headers.get("Retry-After"));
    assert.ok(Number.isFinite(retry) && retry > 0 && retry <= 86400, `Retry-After=${retry}`);
  });

  it("ingest single-view charges 3 units before validation", async () => {
    const kv = new FakeKV();
    const res = await app.request(
      "http://x/ingest",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"image":{}}' },
      { RATE_LIMIT: kv },
    );
    assert.equal(res.status, 400);
    assert.equal(kv.map.get(ipKey("local", Date.now())), "3");
  });

  it("ingest two-view charges 6 units (3 + rotated top-up)", async () => {
    const kv = new FakeKV();
    const res = await app.request(
      "http://x/ingest",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"image":{},"rotated":{}}',
      },
      { RATE_LIMIT: kv },
    );
    assert.equal(res.status, 400);
    assert.equal(kv.map.get(ipKey("local", Date.now())), "6");
  });

  it("missing RATE_LIMIT binding allows (local dev)", async () => {
    const res = await app.request(
      "http://x/resolve",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      {},
    );
    assert.equal(res.status, 400);
  });

  it("KV failure fails CLOSED on /ingest", async () => {
    const kv = new FakeKV("throwGet");
    const res = await app.request(
      "http://x/ingest",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"image":{}}' },
      { RATE_LIMIT: kv },
    );
    assert.equal(res.status, 429);
    assert.equal(((await res.json()) as { error: string }).error, RATE_LIMITS.message);
  });

  it("KV failure fails OPEN on cheap routes", async () => {
    const kv = new FakeKV("throwPut");
    const res = await app.request(
      "http://x/resolve",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      { RATE_LIMIT: kv },
    );
    assert.equal(res.status, 400);
  });
});

describe("CORS", () => {
  const preflight = (origin: string) =>
    app.request(
      "http://x/resolve",
      {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
      },
      {},
    );

  it("preflight from an allowed origin gets CORS headers", async () => {
    const res = await preflight("https://quickaisle.pages.dev");
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://quickaisle.pages.dev");
    assert.ok(res.headers.get("Access-Control-Allow-Methods")?.includes("POST"));
  });

  it("preflight from a preview subdomain is allowed", async () => {
    const res = await preflight("https://abc123.quickaisle.pages.dev");
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://abc123.quickaisle.pages.dev");
  });

  it("preflight from a random origin gets no allow-origin header", async () => {
    const res = await preflight("https://evil.com");
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  });

  it("requests without Origin (native app) are unaffected", async () => {
    const res = await app.request(
      "http://x/resolve",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      {},
    );
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  });

  it("allowed origins are echoed on actual responses", async () => {
    const res = await app.request(
      "http://x/resolve",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:8081" },
        body: "{}",
      },
      {},
    );
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:8081");
  });
});
