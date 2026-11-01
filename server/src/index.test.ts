import { describe, it } from "node:test";
import assert from "node:assert/strict";
import app from "./index.ts";

describe("GET /health", () => {
  it("reports key presence as booleans only, never key material", async () => {
    const res = await app.request("/health", {}, {
      MODEL_API_KEY: "MODEL_SENTINEL_abc123",
      BASETEN_API_KEY: "BASETEN_SENTINEL_def456",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.hasModelKey, true);
    assert.equal(body.hasBasetenKey, true);
    assert.ok(
      !JSON.stringify(body).includes("SENTINEL"),
      "response must not contain key material",
    );
  });

  it("reports false when keys are missing", async () => {
    const res = await app.request("/health", {}, {});
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.hasModelKey, false);
    assert.equal(body.hasBasetenKey, false);
  });

  it("still rejects bad /resolve bodies without keys", async () => {
    const res = await app.request(
      "http://x/resolve",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      {},
    );
    assert.equal(res.status, 400);
  });
});
