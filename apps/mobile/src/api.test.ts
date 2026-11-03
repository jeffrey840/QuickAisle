import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { friendlyReason, ingestErrorForStatus, voiceListErrorForStatus } from "./api.ts";

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

describe("ingestErrorForStatus", () => {
  it("maps ingest failures to friendly messages", () => {
    assert.equal(ingestErrorForStatus(413), "That map photo is too big — try a smaller one.");
    assert.equal(ingestErrorForStatus(502), "Couldn't read this map — try a sharper photo.");
    assert.equal(ingestErrorForStatus(400), "That file isn't a map photo we can read.");
    assert.ok(ingestErrorForStatus(500).includes("500"));
  });
});

describe("voiceListErrorForStatus", () => {
  it("maps voice-list failures to friendly messages", () => {
    assert.equal(voiceListErrorForStatus(413), "That recording is too long — keep it under 30 seconds.");
    assert.equal(voiceListErrorForStatus(504), "Transcription timed out — try again.");
    assert.equal(voiceListErrorForStatus(502), "Couldn't transcribe that — try again.");
    assert.equal(voiceListErrorForStatus(400), "Couldn't use that recording — try again.");
    assert.ok(voiceListErrorForStatus(500).includes("500"));
  });
});
