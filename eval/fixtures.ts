import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Fixture } from "../server/src/providers/index.ts";

/** Load every <key>.json fixture from a directory (eval/node side only). */
export function loadFixtures(dir: string): Record<string, Fixture> {
  const out: Record<string, Fixture> = {};
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const fx = JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture;
    out[fx.key] = fx;
  }
  return out;
}

/** Save one fixture. Content is raw model text — never env, headers, or keys. */
export function saveFixture(dir: string, fx: Fixture): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${fx.key}.json`);
  writeFileSync(path, JSON.stringify(fx, null, 1) + "\n");
  return path;
}
