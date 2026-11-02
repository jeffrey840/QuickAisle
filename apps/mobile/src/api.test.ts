import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { friendlyReason } from "./api.ts";

describe("friendlyReason", () => {
  it("maps network failures to fixed strings", () => {
    assert.equal(
      friendlyReason(new Error("Network request failed")),
      "(no internet connection)",
    );
    assert.equal(
      friendlyReason(new Error("UnknownHostException: foo")),
      "(no internet connection)",
    );
    assert.equal(friendlyReason(new Error("The operation was aborted")), "(timed out)");
    assert.equal(friendlyReason(new Error("request timed out after 45000ms")), "(timed out)");
  });

  it("caps anything else at 80 chars inside parens", () => {
    assert.equal(friendlyReason(new TypeError("x is not a function")), "(TypeError: x is not a function)");
    assert.equal(friendlyReason("o".repeat(200)), `(${"o".repeat(80)})`);
  });
});
