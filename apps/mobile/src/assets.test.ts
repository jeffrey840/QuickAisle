import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bundledAssetUri } from "./assets.ts";

describe("bundledAssetUri", () => {
  it("resolves a web string URL with the fallback size", () => {
    assert.deepEqual(bundledAssetUri("/assets/map.abc123.png", [1662, 1064]), {
      uri: "/assets/map.abc123.png",
      width: 1662,
      height: 1064,
    });
  });

  it("resolves {uri} and {default} wrappers", () => {
    assert.equal(
      bundledAssetUri({ uri: "/assets/a.png" }, [10, 20]).uri,
      "/assets/a.png",
    );
    assert.equal(
      bundledAssetUri({ default: "/assets/b.png" }, [10, 20]).uri,
      "/assets/b.png",
    );
  });

  it("uses the platform resolver when one is passed (native number)", () => {
    const out = bundledAssetUri(42, [1662, 1064], () => ({
      uri: "file:///x/map.png",
      width: 800,
      height: 600,
    }));
    assert.deepEqual(out, { uri: "file:///x/map.png", width: 800, height: 600 });
  });

  it("falls back to the known size when the resolver omits dimensions", () => {
    const out = bundledAssetUri(42, [1662, 1064], () => ({ uri: "file:///x/map.png" }));
    assert.deepEqual(out, { uri: "file:///x/map.png", width: 1662, height: 1064 });
  });

  it("throws when nothing can resolve the module", () => {
    assert.throws(() => bundledAssetUri(42, [1, 2]), /cannot resolve/);
    assert.throws(() => bundledAssetUri(null, [1, 2]), /cannot resolve/);
    assert.throws(
      () => bundledAssetUri(42, [1, 2], () => null),
      /cannot resolve/,
    );
  });
});
