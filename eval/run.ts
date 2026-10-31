/**
 * §10 provider accuracy runner.
 *
 *   npm run eval -- --task=t1,t2 --provider=meta|baseten|both [--runs=3] [--record] [--save-raw]
 *   META_BASE_URL=http://127.0.0.1:9 ALLOW_URL_OVERRIDE=1 npm run eval -- --fallback-test
 *
 * T1/T2 call each provider DIRECTLY (no fallback) for a fair comparison,
 * through the same server/src/providers layer the server uses.
 * Needs keys in server/.dev.vars. DEMO_MODE=1 replays fixtures, no network.
 * --record saves live responses as replay fixtures (refused under DEMO_MODE).
 * --save-raw stores raw model content in the gitignored results JSON only.
 * --fallback-test runs one live T1 through chat() and asserts Baseten answered.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ZodTypeAny } from "zod";
import { StoreDoc } from "@quickaisle/schema";
import { getProvider, NotConfigured } from "@quickaisle/llm";
import {
  chat,
  chatMeta,
  chatBaseten,
  replayFixture,
  type AttemptInfo,
  type ChatImage,
  type DemoOptions,
  type Fixture,
  type ProviderEnv,
  type UsageInfo,
} from "../server/src/providers/index.ts";
import {
  scoreT1,
  scoreT2,
  scoreT3Case,
  AISLE_X_TRUTH,
  DEPT_TRUTH,
  ENTRANCE_TRUTH,
  type T2LayoutAnswer,
  type T3Expect,
} from "./score.ts";
import { T1Schema, T2Schema } from "./schemas.ts";
import { T1_PROMPT, T2_PROMPT } from "./prompts.ts";
import { loadFixtures, saveFixture } from "./fixtures.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = join(root, "server/src/providers/fixtures");

type RunnerProvider = "meta" | "baseten" | "mock";

function arg(name: string, def: string): string {
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]!;
    if (a === `--${name}`) {
      const next = process.argv[i + 1];
      if (next && !next.startsWith("--")) return next;
    }
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return def;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const KNOWN_ENV_KEYS = [
  "MODEL_API_KEY",
  "BASETEN_API_KEY",
  "BASETEN_MODEL",
  "DEMO_MODE",
  "META_BASE_URL",
  "ALLOW_URL_OVERRIDE",
];

function loadDevVars(): Record<string, string> {
  const out: Record<string, string> = {};
  const p = join(root, "server/.dev.vars");
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[2]) out[m[1]!] = m[2];
    }
  }
  // Real environment wins over the file (CI, DEMO_MODE=1 one-shots).
  for (const k of KNOWN_ENV_KEYS) {
    if (process.env[k]) out[k] = process.env[k]!;
  }
  return out;
}

const imgB64 = (rel: string): string =>
  readFileSync(join(root, rel)).toString("base64");

const store = StoreDoc.parse(
  JSON.parse(readFileSync(join(root, "data/stores/heb-001/store.json"), "utf8")),
);
const idToName = new Map(store.products.map((p) => [p.id, p.name]));
const catalog = store.products.map((p) => ({ id: p.id, name: p.name }));

interface RunRecord {
  provider: string;
  task: string;
  run: number;
  ms: number;
  accuracy: number | null;
  score: unknown;
  retries: number;
  fp?: string;
  /** raw model content — only with --save-raw; results JSON stays gitignored */
  raw?: string;
  /** per-attempt diagnostics — results JSON only, never the summary */
  attempts?: AttemptInfo[];
  error?: string;
}
const records: RunRecord[] = [];
const summary: string[] = [];

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
const fpOf = (v: unknown): string => JSON.stringify(v);

/** Compact usage fragment for detail lines: finish=X tok=P|C|T. Empty when absent. */
function usageStr(u?: UsageInfo): string {
  if (!u) return "";
  const parts: string[] = [];
  if (u.finishReason) parts.push(`finish=${u.finishReason}`);
  if (u.promptTokens !== undefined || u.completionTokens !== undefined || u.totalTokens !== undefined) {
    parts.push(`tok=${u.promptTokens ?? "?"}|${u.completionTokens ?? "?"}|${u.totalTokens ?? "?"}`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

/** Failed-attempt fragments (all but the final attempt). Empty when no retry. */
function attemptsStr(attempts?: AttemptInfo[]): string {
  if (!attempts || attempts.length < 2) return "";
  return attempts
    .slice(0, -1)
    .map((a, i) => ` attempt${i}:${usageStr(a.usage)}${a.error ? ` err="${a.error}"` : ""}`)
    .join("");
}

/** Direct provider call — never the fallback path. Mock returns ground truth. */
async function directChat(call: {
  provider: RunnerProvider;
  system: string;
  user: string;
  images: ChatImage[];
  schema: ZodTypeAny;
  name: string;
  key: string;
  env: ProviderEnv;
  fixtures: Record<string, Fixture> | null;
}): Promise<{
  data: unknown;
  raw: string;
  latencyMs: number;
  retries: number;
  usage?: UsageInfo;
  attempts?: AttemptInfo[];
}> {
  const chatArgs = {
    system: call.system,
    user: call.user,
    images: call.images,
    schema: call.schema,
    name: call.name,
  };
  if (call.provider === "mock") {
    console.log("MOCK provider: returning ground truth. Not real results.");
    const data = call.key.startsWith("t1-")
      ? {
          rows: (
            JSON.parse(
              readFileSync(join(root, "eval/gold/directory.json"), "utf8"),
            ) as { items: Array<{ name: string; aisle: string }> }
          ).items,
        }
      : {
          aisles: Object.entries(AISLE_X_TRUTH).map(([n, x]) => ({
            n: Number(n),
            x,
            yTop: 210,
            yBot: 660,
          })),
          departments: DEPT_TRUTH,
          entrances: ENTRANCE_TRUTH.map((xy) => ({ xy })),
        };
    return { data, raw: JSON.stringify(data), latencyMs: 1, retries: 0 };
  }
  if (call.env.DEMO_MODE === "1") {
    if (!call.fixtures) throw new Error("DEMO_MODE=1 but no fixtures loaded");
    const demo: DemoOptions = { key: call.key, fixtures: call.fixtures };
    return replayFixture(chatArgs, demo);
  }
  return call.provider === "meta"
    ? chatMeta(chatArgs, call.env)
    : chatBaseten(chatArgs, call.env);
}

/** Per-provider aggregate: latency p50/max, success, pairwise agreement. */
function aggregate(task: string, provider: string): void {
  const rs = records.filter((r) => r.task === task && r.provider === provider);
  if (rs.length === 0) return;
  const ok = rs.filter((r) => !r.error);
  const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(0.5 * lat.length))]! : 0;
  const max = lat.length ? lat[lat.length - 1]! : 0;
  const fps = ok.map((r) => r.fp ?? "");
  let agree = 0;
  let pairs = 0;
  for (let i = 0; i < fps.length; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      pairs++;
      if (fps[i] === fps[j]) agree++;
    }
  }
  summary.push(
    `AGG ${task} ${provider}: n=${rs.length} ok=${ok.length} ` +
      `p50=${p50}ms max=${max}ms agree=${pairs ? pct(agree / pairs) : "n/a"}`,
  );
}

interface TaskCtx {
  record: boolean;
  saveRaw: boolean;
  env: ProviderEnv;
  fixtures: Record<string, Fixture> | null;
}

function maybeRecord(
  ctx: TaskCtx,
  provider: RunnerProvider,
  key: string,
  raw: string,
  latencyMs: number,
): void {
  if (!ctx.record) return;
  if (provider === "mock") {
    summary.push("  record skipped for mock (ground truth is not a model response)");
    return;
  }
  const path = saveFixture(FIXTURE_DIR, {
    key,
    provider,
    content: raw,
    latencyMs,
    recordedAt: new Date().toISOString(),
  });
  summary.push(`  recorded ${path}`);
}

async function taskT1(providers: RunnerProvider[], runs: number, ctx: TaskCtx): Promise<void> {
  const goldFile = JSON.parse(
    readFileSync(join(root, "eval/gold/directory.json"), "utf8"),
  ) as {
    items: Array<{ name: string; aisle: string }>;
    known_conflicts: Array<{ name: string; directory: string; map: string }>;
  };
  const conflictNames = goldFile.known_conflicts.map((c) => c.name);
  const b64 = imgB64("data/stores/heb-001/directory.png");
  for (const name of providers) {
    const key = `t1-${name}`;
    for (let r = 0; r < runs; r++) {
      const t0 = Date.now();
      try {
        const res = await directChat({
          provider: name,
          system: T1_PROMPT.system,
          user: T1_PROMPT.user,
          images: [{ mime: "image/png", b64 }],
          schema: T1Schema,
          name: "directory_rows",
          key,
          env: ctx.env,
          fixtures: ctx.fixtures,
        });
        const v = T1Schema.safeParse(res.data);
        if (!v.success) throw new Error("response failed T1 schema validation");
        const s = scoreT1(goldFile.items, v.data.rows, conflictNames);
        if (s.rowAccuracy === 0) {
          throw new Error(`scored 0% (${s.rowCorrect}/${s.total} rows) — counting as failure`);
        }
        records.push({
          provider: name, task: "t1", run: r, ms: Date.now() - t0,
          accuracy: s.rowAccuracy, score: s, retries: res.retries,
          fp: fpOf([...v.data.rows].sort((a, b) => a.name.localeCompare(b.name))),
          ...(ctx.saveRaw ? { raw: res.raw } : {}),
          attempts: res.attempts,
        });
        summary.push(
          `T1 ${name} run${r} [${T1_PROMPT.version}]: rows ${pct(s.rowAccuracy)} ` +
            `(${s.rowCorrect}/${s.total}) aisle ${pct(s.aisleAccuracy)} extras ${s.extras.length} ` +
            `mismatch ${s.mismatches.length} retries=${res.retries} ${res.latencyMs}ms${usageStr(res.usage)}${attemptsStr(res.attempts)}`,
        );
        for (const m of s.mismatches) {
          summary.push(
            `  T1MISS ${name} run${r}: ${m.name} — want "${m.expectedAisle}", got ` +
              (m.gotAisle === null ? "MISSING" : `"${m.gotAisle}"`),
          );
        }
        if (s.extras.length) summary.push(`  T1EXTRA ${name} run${r}: ${s.extras.join(" | ")}`);
        for (const c of s.conflicts) {
          summary.push(
            `  T1CONFLICT ${name} run${r}: ${c.name} — directory "${c.expectedAisle}", ` +
              `model said ${c.gotAisle === null ? "MISSING" : `"${c.gotAisle}"`} (not a failure)`,
          );
        }
        maybeRecord(ctx, name, key, res.raw, res.latencyMs);
      } catch (e) {
        if (e instanceof NotConfigured) throw e;
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        records.push({
          provider: name, task: "t1", run: r, ms: Date.now() - t0,
          accuracy: null, score: null, retries: 0, error: msg,
        });
        summary.push(`T1 ${name} run${r}: ERROR ${msg}`);
      }
    }
    aggregate("t1", name);
  }
}

function t2Composite(s: {
  aisleCountOk: boolean;
  orderOk: boolean;
  deptsFound: number;
  deptsTotal: number;
  entrancesFound: number;
}): number {
  return (
    (s.aisleCountOk ? 1 : 0) +
    (s.orderOk ? 1 : 0) +
    s.deptsFound / s.deptsTotal +
    s.entrancesFound / 2
  ) / 4;
}

async function taskT2(providers: RunnerProvider[], runs: number, ctx: TaskCtx): Promise<void> {
  const b64 = imgB64("data/stores/heb-001/map.png");
  for (const name of providers) {
    const key = `t2-${name}`;
    for (let r = 0; r < runs; r++) {
      const t0 = Date.now();
      try {
        const res = await directChat({
          provider: name,
          system: T2_PROMPT.system,
          user: T2_PROMPT.user,
          images: [{ mime: "image/png", b64 }],
          schema: T2Schema,
          name: "map_layout",
          key,
          env: ctx.env,
          fixtures: ctx.fixtures,
        });
        const v = T2Schema.safeParse(res.data);
        if (!v.success) throw new Error("response failed T2 schema validation");
        const ans: T2LayoutAnswer = {
          aisles: v.data.aisles.map((a) => ({ n: a.n, x: a.x })),
          departments: v.data.departments.map((d) => ({
            name: d.name,
            xy: d.xy as [number, number],
          })),
          entrances: v.data.entrances.map((e) => ({ xy: e.xy as [number, number] })),
        };
        const s = scoreT2(ans);
        const acc = t2Composite(s);
        if (acc === 0) {
          throw new Error("scored 0% (empty or fully wrong layout) — counting as failure");
        }
        records.push({
          provider: name, task: "t2", run: r, ms: Date.now() - t0,
          accuracy: acc, score: s, retries: res.retries, fp: fpOf(ans),
          ...(ctx.saveRaw ? { raw: res.raw } : {}),
          attempts: res.attempts,
        });
        summary.push(
          `T2 ${name} run${r} [${T2_PROMPT.version}]: acc ${pct(acc)} ` +
            `aisles ${s.aisleCount}${s.aisleCountOk ? "" : " (want 17)"} ` +
            `order ${s.orderOk ? "ok" : "BAD"} xErr ${s.meanXErrorPx.toFixed(0)}px ` +
            `depts ${s.deptsFound}/${s.deptsTotal} entr ${s.entrancesFound}/2 ` +
            `retries=${res.retries} ${res.latencyMs}ms${usageStr(res.usage)}${attemptsStr(res.attempts)}`,
        );
        if (s.deptsMissing.length) {
          summary.push(`  T2DEPTS-MISSING ${name} run${r}: ${s.deptsMissing.join(", ")}`);
        }
        // Day 3: end-to-end — build store.json from the layout, run routing A/B.
        maybeRecord(ctx, name, key, res.raw, res.latencyMs);
      } catch (e) {
        if (e instanceof NotConfigured) throw e;
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        records.push({
          provider: name, task: "t2", run: r, ms: Date.now() - t0,
          accuracy: null, score: null, retries: 0, error: msg,
        });
        summary.push(`T2 ${name} run${r}: ERROR ${msg}`);
      }
    }
    aggregate("t2", name);
  }
}

async function taskT3(providers: RunnerProvider[], runs: number): Promise<void> {
  const live = providers.filter((p) => p !== "mock");
  if (live.length < providers.length) {
    summary.push("T3 mock skipped: mock supports t1/t2 only.");
  }
  const cases = JSON.parse(
    readFileSync(join(root, "eval/cases/resolve.json"), "utf8"),
  ) as { cases: Array<{ input: string; expect: T3Expect }> };
  for (const name of live) {
    // Day 2: rewire to server/src/providers chat() with a resolve prompt.
    const p = getProvider(name as "meta" | "baseten", loadDevVars());
    for (let r = 0; r < runs; r++) {
      const t0 = Date.now();
      try {
        const { answers } = await p.resolveItems(
          cases.cases.map((c) => c.input),
          catalog,
        );
        let correct = 0;
        let invented = 0;
        answers.forEach((a, i) => {
          const topNames: string[] = [];
          const bad: string[] = [];
          for (const m of a.matches) {
            const n = idToName.get(m.productId);
            if (n) topNames.push(n);
            else bad.push(m.productId);
          }
          invented += bad.length;
          const s = scoreT3Case(cases.cases[i]!.expect, {
            topNames,
            needsClarification: a.needsClarification,
            invented: bad,
          });
          if (s.correct) correct++;
        });
        const score = { top1: correct / cases.cases.length, correct, total: cases.cases.length, invented };
        if (score.top1 === 0) {
          throw new Error("scored 0% — counting as failure");
        }
        records.push({
          provider: name, task: "t3", run: r, ms: Date.now() - t0,
          accuracy: score.top1, score, retries: 0, fp: fpOf(answers),
        });
        summary.push(
          `T3 ${name} run${r}: top-1 ${pct(score.top1)} (${correct}/${cases.cases.length}), invented ${invented}`,
        );
      } catch (e) {
        if (e instanceof NotConfigured) throw e;
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        records.push({
          provider: name, task: "t3", run: r, ms: Date.now() - t0,
          accuracy: null, score: null, retries: 0, error: msg,
        });
        summary.push(`T3 ${name} run${r}: ERROR ${msg}`);
      }
    }
    aggregate("t3", name);
  }
}

async function taskT4(): Promise<void> {
  const exp = join(root, "eval/cases/list-photos/expected.json");
  if (!existsSync(exp)) {
    summary.push("T4 skipped: eval/cases/list-photos/expected.json not present (owner supplies photos, §9C).");
    return;
  }
  summary.push("T4: photo cases present — runner lands with /read-list on Day 2.");
}

function printTable(): string[] {
  const lines = [
    "",
    "| provider | test | accuracy | p50 | max | retries | errors |",
    "|----------|------|----------|-----|-----|---------|--------|",
  ];
  const keys = [...new Set(records.map((r) => `${r.provider}\0${r.task}`))].sort();
  for (const k of keys) {
    const [provider, task] = k.split("\0") as [string, string];
    const rs = records.filter((r) => r.provider === provider && r.task === task);
    const ok = rs.filter((r) => !r.error && r.accuracy !== null);
    const acc = ok.length ? ok.reduce((s, r) => s + r.accuracy!, 0) / ok.length : NaN;
    const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
    const p50 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(0.5 * lat.length))] : NaN;
    const max = lat.length ? lat[lat.length - 1] : NaN;
    const retries = rs.reduce((s, r) => s + r.retries, 0);
    const errors = rs.filter((r) => r.error).length;
    const fmt = (n: number, suffix = ""): string => (Number.isNaN(n) ? "n/a" : `${n}${suffix}`);
    lines.push(
      `| ${provider} | ${task} | ${Number.isNaN(acc) ? "n/a" : pct(acc)} | ` +
        `${fmt(p50, "ms")} | ${fmt(max, "ms")} | ${retries} | ${errors} |`,
    );
  }
  lines.push("");
  return lines;
}

/**
 * Live fallback test (closed-port leg): point Meta at an unreachable URL,
 * run one T1 call through chat(), assert it fell through to Baseten.
 * Prints PASS/FAIL to console only — no result files. Exit 0/1.
 */
async function fallbackTest(env: ProviderEnv): Promise<void> {
  if (env.DEMO_MODE === "1") {
    console.error("fallback-test is a live test; refusing under DEMO_MODE=1.");
    process.exitCode = 2;
    return;
  }
  if (env.ALLOW_URL_OVERRIDE !== "1" || !env.META_BASE_URL) {
    console.error("fallback-test needs META_BASE_URL and ALLOW_URL_OVERRIDE=1 (env or server/.dev.vars).");
    process.exitCode = 2;
    return;
  }
  if (!env.BASETEN_API_KEY) {
    console.error("fallback-test needs BASETEN_API_KEY (the fallback target).");
    process.exitCode = 2;
    return;
  }
  const b64 = imgB64("data/stores/heb-001/directory.png");
  console.log(`meta base override: ${env.META_BASE_URL} (expect unreachable → fallback)`);
  const t0 = Date.now();
  try {
    const res = await chat(
      {
        system: T1_PROMPT.system,
        user: T1_PROMPT.user,
        images: [{ mime: "image/png", b64 }],
        schema: T1Schema,
        name: "directory_rows",
      },
      env,
    );
    if (res.provider !== "baseten") {
      console.error(`FAIL: expected fallback to baseten, got ${res.provider}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `PASS: fell back to baseten (${Date.now() - t0}ms, ` +
        `reason=${res.fallbackReason ?? "n/a"}, retries=${res.retries})`,
    );
  } catch (e) {
    console.error(`FAIL: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const tasks = arg("task", "all").split(",").map((t) => t.trim());
  const runTask = (t: string): boolean => tasks.includes("all") || tasks.includes(t);
  const providerArg = arg("provider", "both");
  const runs = Number(arg("runs", "3"));
  const record = flag("record");
  const saveRaw = flag("save-raw");
  const providers: RunnerProvider[] =
    providerArg === "both" ? ["meta", "baseten"] : [providerArg as RunnerProvider];
  const env: ProviderEnv = loadDevVars();
  if (flag("fallback-test")) {
    await fallbackTest(env);
    return;
  }
  if (env.DEMO_MODE === "1" && record) {
    console.error("Refusing --record under DEMO_MODE=1 (replays are not model responses).");
    process.exitCode = 2;
    return;
  }
  const fixtures = env.DEMO_MODE === "1" ? loadFixtures(FIXTURE_DIR) : null;
  const ctx: TaskCtx = { record, saveRaw, env, fixtures };

  let blocked = false;
  const runOne = async (t: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof NotConfigured) {
        summary.push(`${t.toUpperCase()} blocked: ${(e as Error).message}`);
        blocked = true;
        return;
      }
      throw e;
    }
  };
  if (runTask("t1")) await runOne("t1", () => taskT1(providers, runs, ctx));
  if (runTask("t2")) await runOne("t2", () => taskT2(providers, runs, ctx));
  if (runTask("t3")) await runOne("t3", () => taskT3(providers, runs));
  if (runTask("t4")) await taskT4();

  const table = printTable();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  mkdirSync(join(root, "eval/results"), { recursive: true });
  writeFileSync(
    join(root, `eval/results/${stamp}-${tasks.join("+")}.json`),
    JSON.stringify(records, null, 1),
  );
  const md = [
    `# Eval ${stamp} — task=${tasks.join(",")} provider=${providerArg} runs=${runs}${record ? " RECORD" : ""}${env.DEMO_MODE === "1" ? " DEMO" : ""}`,
    "",
    ...table,
    ...summary.map((s) => `- ${s}`),
    "",
  ].join("\n");
  writeFileSync(join(root, `eval/results/${stamp}-summary.md`), md);
  console.log(md);

  if (records.some((r) => r.error?.startsWith("ConfigError"))) {
    console.log("Hint: fill MODEL_API_KEY / BASETEN_API_KEY in server/.dev.vars and re-run.");
    process.exitCode = 2;
  }
  if (blocked) {
    console.log("Some tasks are blocked (see above).");
    process.exitCode = 2;
  }
}

await main();
