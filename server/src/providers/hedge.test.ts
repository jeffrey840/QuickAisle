import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hedged } from "./hedge.ts";

class Worthy extends Error {}
class Fatal extends Error {}
const isWorthy = (e: unknown): boolean => e instanceof Worthy;

/** Fake provider: resolves `value` after `ms`, unless aborted first. */
function fake<T>(
  value: T,
  ms: number,
  seen: { aborted: boolean; started: boolean },
  failWith?: unknown,
): (signal: AbortSignal) => Promise<T> {
  return (signal) =>
    new Promise<T>((resolve, reject) => {
      seen.started = true;
      if (signal.aborted) {
        seen.aborted = true;
        reject(new Error("aborted"));
        return;
      }
      const timer = setTimeout(() => {
        if (failWith !== undefined) reject(failWith);
        else resolve(value);
      }, ms);
      signal.addEventListener(
        "abort",
        () => {
          seen.aborted = true;
          clearTimeout(timer);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
}

describe("hedged", () => {
  it("fast primary wins; backup never starts", async () => {
    const p = { aborted: false, started: false };
    const b = { aborted: false, started: false };
    const out = await hedged(fake("m", 5, p), fake("b", 5, b), 30, isWorthy);
    assert.deepEqual(
      { value: out.value, winner: out.winner, backupStarted: out.backupStarted },
      { value: "m", winner: "primary", backupStarted: false },
    );
    assert.equal(b.started, false);
    assert.equal(p.aborted, false);
  });

  it("slow primary loses to the backup and is aborted", async () => {
    const p = { aborted: false, started: false };
    const b = { aborted: false, started: false };
    const out = await hedged(fake("m", 200, p), fake("b", 5, b), 20, isWorthy);
    assert.equal(out.value, "b");
    assert.equal(out.winner, "backup");
    assert.equal(out.backupStarted, true);
    assert.equal(p.aborted, true);
    assert.equal(b.aborted, false);
  });

  it("worthy primary failure starts the backup immediately", async () => {
    const p = { aborted: false, started: false };
    const b = { aborted: false, started: false };
    const t0 = Date.now();
    const out = await hedged(
      fake("m", 5, p, new Worthy("meta 500")),
      fake("b", 5, b),
      10_000,
      isWorthy,
    );
    assert.equal(out.value, "b");
    assert.equal(out.backupStarted, true);
    assert.ok(Date.now() - t0 < 1000, "must not wait for the hedge timer");
  });

  it("fatal primary failure fails loud and aborts the backup", async () => {
    const p = { aborted: false, started: false };
    const b = { aborted: false, started: false };
    await assert.rejects(
      hedged(fake("m", 30, p, new Fatal("meta 400")), fake("b", 200, b), 5, isWorthy),
      /meta 400/,
    );
    assert.equal(b.aborted, true);
  });

  it("backup failure while primary runs still lets the primary win", async () => {
    const p = { aborted: false, started: false };
    const b = { aborted: false, started: false };
    const out = await hedged(
      fake("m", 40, p),
      fake("b", 5, b, new Worthy("baseten 500")),
      5,
      isWorthy,
    );
    assert.equal(out.value, "m");
    assert.equal(out.winner, "primary");
  });

  it("both failing surfaces the backup error when primary failed first", async () => {
    const p = { aborted: false, started: false };
    const b = { aborted: false, started: false };
    await assert.rejects(
      hedged(
        fake("m", 5, p, new Worthy("primary-down")),
        fake("b", 5, b, new Worthy("backup-down")),
        10_000,
        isWorthy,
      ),
      /backup-down/,
    );
  });

  it("both failing surfaces the primary error when backup failed first", async () => {
    const p = { aborted: false, started: false };
    const b = { aborted: false, started: false };
    await assert.rejects(
      hedged(
        fake("m", 40, p, new Worthy("primary-down")),
        fake("b", 5, b, new Worthy("backup-down")),
        5,
        isWorthy,
      ),
      /primary-down/,
    );
  });
});
