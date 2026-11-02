/**
 * Direct ingest pipeline runner (no HTTP, no wrangler): 3 parallel Meta
 * calls on a local map image + majority merge. Writes raw runs + merged
 * draft to eval/results/ (gitignored) and prints a short summary.
 *
 * Run: node scripts/ingest-try.ts <image-path> [--record] [--temperature 0.2]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatMeta } from "../server/src/providers/meta.ts";
import { INGEST_PROMPT, IngestSchema, type IngestData } from "../server/src/ingest-contract.ts";
import { capMergedIngest, mergeIngestRuns } from "../server/src/ingest-merge.ts";
import { saveFixture } from "../eval/fixtures.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg: string, code = 2): never => {
  console.error(msg);
  process.exit(code);
  throw new Error("unreachable");
};

const argv = process.argv.slice(2);
const imagePath: string =
  argv.find((a) => !a.startsWith("--")) ??
  fail("usage: node scripts/ingest-try.ts <image-path> [--record] [--temperature 0.2]");
const record = argv.includes("--record");
const tempIdx = argv.indexOf("--temperature");
const tempRaw = tempIdx >= 0 ? argv[tempIdx + 1] : undefined;
if (tempRaw !== undefined && !Number.isFinite(Number(tempRaw))) {
  fail("--temperature needs a number");
}
const temperature = tempRaw === undefined ? undefined : Number(tempRaw);
if (!existsSync(imagePath)) fail(`no such file: ${imagePath}`);
const ext = extname(imagePath).toLowerCase();
const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "";
if (!mime) fail("image must be .png, .jpg, or .jpeg");
const bytes = readFileSync(imagePath);
if (bytes.length > 3_145_728) fail(`image exceeds 3 MB (${bytes.length} bytes)`);
const b64 = bytes.toString("base64");

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

const base = basename(imagePath, ext);
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

const one = async (): Promise<RunOut> => {
  const t0 = Date.now();
  try {
    const res = await chatMeta(
      {
        system: INGEST_PROMPT.system,
        user: INGEST_PROMPT.user,
        images: [{ mime, b64 }],
        schema: IngestSchema,
        name: "ingest_map",
        timeoutMs: 45_000,
        ...(temperature !== undefined ? { temperature } : {}),
      },
      env,
    );
    return { ok: true, ms: Date.now() - t0, data: res.data, raw: res.raw };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
};

const runs = await Promise.all([one(), one(), one()]);
const succeeded = runs.filter((r) => r.ok && r.data) as Array<RunOut & { data: IngestData; raw: string }>;
runs.forEach((r, i) => {
  writeFileSync(
    join(outDir, `ingest-${base}-${stamp}-run${i}.json`),
    JSON.stringify({ ok: r.ok, ms: r.ms, error: r.error ?? null, data: r.data ?? null }, null, 1),
  );
});

if (succeeded.length === 0) {
  console.log(`runsOk=0/3 ms=[${runs.map((r) => r.ms).join(",")}]`);
  for (const [i, r] of runs.entries()) console.log(`run${i} FAILED: ${r.error}`);
  process.exit(1);
}

const merged = capMergedIngest(mergeIngestRuns(succeeded.map((r) => r.data)));
writeFileSync(join(outDir, `ingest-${base}-${stamp}-merged.json`), JSON.stringify(merged, null, 1));

if (record) {
  const fxDir = join(root, "server/src/providers/fixtures");
  succeeded.forEach((r, i) => {
    saveFixture(fxDir, {
      key: `ingest-${base}-run${i}`,
      provider: "meta",
      content: r.raw,
      latencyMs: r.ms,
      recordedAt: new Date().toISOString(),
    });
  });
  console.log(`recorded ${succeeded.length} fixture(s) to server/src/providers/fixtures/`);
}

const totalItems = merged.aisles.reduce((s, a) => s + a.items.length, 0);
console.log(`runsOk=${merged.runsOk}/3 lowConfidence=${merged.lowConfidence}`);
console.log(`aisles=${merged.aisles.length} [${merged.aisles.map((a) => a.n).join(", ")}]`);
console.log(`itemsPerAisle=[${merged.aisles.map((a) => a.items.length).join(", ")}] totalItems=${totalItems}`);
console.log(`departments=[${merged.departments.map((d) => d.name).join(", ") || "none"}]`);
console.log(`entrances=${merged.entrances.length}`);
for (const a of merged.aisles) {
  if (!/^\d+$/.test(a.n)) console.log(`flag: non-numeric aisle n="${a.n}"`);
  else if (Number(a.n) > 39) console.log(`flag: aisle n="${a.n}" > 39`);
}
console.log(`ms=[${runs.map((r) => r.ms).join(", ")}]`);
