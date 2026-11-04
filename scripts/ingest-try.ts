/**
 * Direct ingest pipeline runner (no HTTP, no wrangler): 3 parallel Meta
 * calls on a local map image + majority merge. Writes raw runs + merged
 * draft to eval/results/ (gitignored) and prints a short summary.
 *
 * Run: node scripts/ingest-try.ts <image-path> [--record] [--temperature 0.2] [--rotated <path>]
 *
 * --rotated takes a second, already-rotated (90° clockwise) image; the
 * script never rotates anything itself. With it, 3+3 reads run in parallel
 * and combine like /ingest (C4); without it, output is exactly as before.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatMeta } from "../server/src/providers/meta.ts";
import { INGEST_PROMPT, IngestSchema, type IngestData } from "../server/src/ingest-contract.ts";
import { capMergedIngest, combineIngestViews, mergeIngestRuns } from "../server/src/ingest-merge.ts";
import { saveFixture } from "../eval/fixtures.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg: string, code = 2): never => {
  console.error(msg);
  process.exit(code);
  throw new Error("unreachable");
};

const USAGE = "usage: node scripts/ingest-try.ts <image-path> [--record] [--temperature 0.2] [--rotated <path>]";
const argv = process.argv.slice(2);
const record = argv.includes("--record");
const tempIdx = argv.indexOf("--temperature");
const tempRaw = tempIdx >= 0 ? argv[tempIdx + 1] : undefined;
if (tempRaw !== undefined && !Number.isFinite(Number(tempRaw))) {
  fail("--temperature needs a number");
}
const temperature = tempRaw === undefined ? undefined : Number(tempRaw);
const rotIdx = argv.indexOf("--rotated");
const rotPath = rotIdx >= 0 ? argv[rotIdx + 1] : undefined;
if (rotIdx >= 0 && (!rotPath || rotPath.startsWith("--"))) {
  fail("--rotated needs a path");
}
// Flag values are not positionals (so --rotated may precede the image path).
const valued = new Set<number>();
if (tempIdx >= 0) {
  valued.add(tempIdx);
  valued.add(tempIdx + 1);
}
if (rotIdx >= 0) {
  valued.add(rotIdx);
  valued.add(rotIdx + 1);
}
const imagePath: string =
  argv.find((a, i) => !valued.has(i) && !a.startsWith("--")) ?? fail(USAGE);

const loadImage = (p: string, label: string): { mime: string; b64: string } => {
  if (!existsSync(p)) fail(`no such file: ${p}`);
  const e = extname(p).toLowerCase();
  const m = e === ".png" ? "image/png" : e === ".jpg" || e === ".jpeg" ? "image/jpeg" : "";
  if (!m) fail(`${label}image must be .png, .jpg, or .jpeg`);
  const buf = readFileSync(p);
  if (buf.length > 3_145_728) fail(`${label}image exceeds 3 MB (${buf.length} bytes)`);
  return { mime: m, b64: buf.toString("base64") };
};
const ext = extname(imagePath).toLowerCase();
const { mime, b64 } = loadImage(imagePath, "");
const rotImg = rotPath ? loadImage(rotPath, "rotated ") : null;

// Key loading mirrors eval/run.ts: server/.dev.vars, env wins.
const env: Record<string, string> = {};
const devVars = join(root, "server/.dev.vars");
if (existsSync(devVars)) {
  for (const line of readFileSync(devVars, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2]) env[m[1]!] = m[2];
  }
}
if (process.env.MODEL_API_KEY) env.MODEL_API_KEY = process.env.MODEL_API_KEY;
if (!env.MODEL_API_KEY) fail("MODEL_API_KEY missing — fill server/.dev.vars or export it.");

// Parent folder, not file basename: both maps are called map.png.
const parent = basename(dirname(imagePath));
const base = parent === "." || parent === "" ? basename(imagePath, ext) : parent;
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const outDir = join(root, "eval/results");
mkdirSync(outDir, { recursive: true });

interface RunOut {
  ok: boolean;
  ms: number;
  data?: IngestData;
  raw?: string;
  error?: string;
}

const one = async (img: { mime: string; b64: string }): Promise<RunOut> => {
  const t0 = Date.now();
  try {
    const res = await chatMeta(
      {
        system: INGEST_PROMPT.system,
        user: INGEST_PROMPT.user,
        images: [{ mime: img.mime, b64: img.b64 }],
        schema: IngestSchema,
        name: "ingest_map",
        timeoutMs: 50_000,
        ...(temperature !== undefined ? { temperature } : {}),
      },
      env,
    );
    return { ok: true, ms: Date.now() - t0, data: res.data, raw: res.raw };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
};

const orig = { mime, b64 };
// 3 original + 3 rotated reads, all in parallel (original only without --rotated).
const all = await Promise.all(
  rotImg
    ? [one(orig), one(orig), one(orig), one(rotImg), one(rotImg), one(rotImg)]
    : [one(orig), one(orig), one(orig)],
);
const runs = all.slice(0, 3);
const rotRuns = rotImg ? all.slice(3) : [];
const succeeded = runs.filter((r) => r.ok && r.data) as Array<RunOut & { data: IngestData; raw: string }>;
const rotSucceeded = rotRuns.filter((r) => r.ok && r.data) as Array<RunOut & { data: IngestData; raw: string }>;
runs.forEach((r, i) => {
  writeFileSync(
    join(outDir, `ingest-${base}-${stamp}-run${i}.json`),
    JSON.stringify({ ok: r.ok, ms: r.ms, error: r.error ?? null, data: r.data ?? null }, null, 1),
  );
});
if (rotImg) {
  rotRuns.forEach((r, i) => {
    writeFileSync(
      join(outDir, `ingest-${base}-${stamp}-rot-run${i}.json`),
      JSON.stringify({ ok: r.ok, ms: r.ms, error: r.error ?? null, data: r.data ?? null }, null, 1),
    );
  });
}

if (succeeded.length === 0) {
  const allMs = rotImg ? [...runs, ...rotRuns] : runs;
  console.log(`runsOk=0/${rotImg ? 6 : 3} ms=[${allMs.map((r) => r.ms).join(",")}]`);
  for (const [i, r] of runs.entries()) console.log(`run${i} FAILED: ${r.error}`);
  if (rotImg) for (const [i, r] of rotRuns.entries()) console.log(`rot-run${i} FAILED: ${r.error}`);
  process.exit(1);
}

const merged = rotImg
  ? capMergedIngest(
      combineIngestViews(
        mergeIngestRuns(succeeded.map((r) => r.data)),
        rotSucceeded.length > 0 ? mergeIngestRuns(rotSucceeded.map((r) => r.data)) : null,
      ),
    )
  : capMergedIngest(mergeIngestRuns(succeeded.map((r) => r.data)));
writeFileSync(join(outDir, `ingest-${base}-${stamp}-merged.json`), JSON.stringify(merged, null, 1));

if (record) {
  const fxDir = join(root, "server/src/providers/fixtures");
  const save = (r: RunOut & { data: IngestData; raw: string }, key: string): void => {
    saveFixture(fxDir, {
      key,
      provider: "meta",
      content: r.raw,
      latencyMs: r.ms,
      recordedAt: new Date().toISOString(),
    });
  };
  succeeded.forEach((r, i) => save(r, `ingest-${base}-run${i}`));
  if (rotImg) rotSucceeded.forEach((r, i) => save(r, `ingest-${base}-rot-run${i}`));
  console.log(`recorded ${succeeded.length + rotSucceeded.length} fixture(s) to server/src/providers/fixtures/`);
}

const totalItems = merged.aisles.reduce((s, a) => s + a.items.length, 0);
console.log(`runsOk=${merged.runsOk}/${rotImg ? 6 : 3} lowConfidence=${merged.lowConfidence}`);
console.log(`aisles=${merged.aisles.length} [${merged.aisles.map((a) => a.n).join(", ")}]`);
console.log(`itemsPerAisle=[${merged.aisles.map((a) => a.items.length).join(", ")}] totalItems=${totalItems}`);
if (rotImg) {
  console.log(`itemsView=[${merged.aisles.map((a) => `${a.n}:${a.itemsView ?? "original"}`).join(", ")}]`);
}
console.log(`departments=[${merged.departments.map((d) => d.name).join(", ") || "none"}]`);
console.log(`entrances=${merged.entrances.length}`);
for (const a of merged.aisles) {
  if (!/^\d+$/.test(a.n)) console.log(`flag: non-numeric aisle n="${a.n}"`);
  else if (Number(a.n) > 39) console.log(`flag: aisle n="${a.n}" > 39`);
}
console.log(`ms=[${(rotImg ? [...runs, ...rotRuns] : runs).map((r) => r.ms).join(", ")}]`);
