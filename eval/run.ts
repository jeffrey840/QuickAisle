/**
 * §10 provider accuracy runner.
 *
 *   node eval/run.ts --task t1|t2|t3|t4|all --provider meta|baseten|both --runs 3
 *
 * Calls the SAME @quickaisle/llm provider layer the server uses, so results
 * reflect the real code path. Needs keys in server/.dev.vars (see §9B).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StoreDoc } from "@quickaisle/schema";
import {
  getProvider,
  NotConfigured,
  type LlmProvider,
  type ProviderName,
} from "@quickaisle/llm";
import {
  AISLE_X_TRUTH,
  DEPT_TRUTH,
  ENTRANCE_TRUTH,
  scoreT1,
  scoreT2,
  scoreT3Case,
  type T2LayoutAnswer,
  type T3Expect,
} from "./score.ts";

/**
 * Test-only provider that returns ground truth. Used ONLY to verify the
 * runner machinery (runs loop, scoring integration, results files) before
 * real keys arrive. Never a product path: it cannot be selected by the
 * server, and its output files are labeled MOCK.
 */
class MockProvider implements LlmProvider {
  readonly name = "mock" as ProviderName;
  async resolveItems(): Promise<never> {
    throw new Error("mock supports t1/t2 only");
  }
  async readList(): Promise<never> {
    throw new Error("mock supports t1/t2 only");
  }
  async readDirectory(): Promise<{
    rows: Array<{ name: string; aisle: string }>;
    rawMs: number;
  }> {
    const gold = JSON.parse(
      readFileSync(join(root, "eval/gold/directory.json"), "utf8"),
    ) as { items: Array<{ name: string; aisle: string }> };
    return { rows: gold.items, rawMs: 1 };
  }
  async readMap(): Promise<{
    layout: {
      imageSize: [number, number];
      aisles: Array<{ n: number; x: number; yTop: number; yBot: number }>;
      departments: Array<{ name: string; xy: [number, number] }>;
      entrances: Array<{ xy: [number, number] }>;
    };
    rawMs: number;
  }> {
    return {
      layout: {
        imageSize: [1268, 1048],
        aisles: Object.entries(AISLE_X_TRUTH).map(([n, x]) => ({
          n: Number(n),
          x,
          yTop: 210,
          yBot: 660,
        })),
        departments: DEPT_TRUTH,
        entrances: ENTRANCE_TRUTH.map((xy) => ({ xy })),
      },
      rawMs: 1,
    };
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

function loadDevVars(): Record<string, string> {
  const p = join(root, "server/.dev.vars");
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2]) out[m[1]!] = m[2];
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
  score: unknown;
  /** fingerprint of the normalized raw answer — for cross-run agreement */
  fp?: string;
  error?: string;
}
const records: RunRecord[] = [];
const summary: string[] = [];

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

const fpOf = (v: unknown): string => JSON.stringify(v);

/** Per-provider aggregate: latency p50/p95, success rate, pairwise agreement. */
function aggregate(task: string, provider: string): void {
  const rs = records.filter((r) => r.task === task && r.provider === provider);
  if (rs.length === 0) return;
  const ok = rs.filter((r) => !r.error);
  const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
  const q = (p: number): number =>
    lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]! : 0;
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
      `p50=${q(0.5)}ms p95=${q(0.95)}ms agree=${pairs ? pct(agree / pairs) : "n/a"}`,
  );
}

type RunnerProvider = ProviderName | "mock";

function makeProvider(name: RunnerProvider): LlmProvider {
  if (name === "mock") return new MockProvider();
  return getProvider(name, loadDevVars());
}

async function taskT1(providers: RunnerProvider[], runs: number): Promise<void> {
  const gold = JSON.parse(
    readFileSync(join(root, "eval/gold/directory.json"), "utf8"),
  ) as { items: Array<{ name: string; aisle: string }> };
  const b64 = imgB64("data/stores/heb-001/directory.png");
  for (const name of providers) {
    const p = makeProvider(name);
    for (let r = 0; r < runs; r++) {
      const t0 = Date.now();
      try {
        const { rows, rawMs } = await p.readDirectory(b64, "image/png");
        const s = scoreT1(gold.items, rows);
        records.push({
          provider: name, task: "t1", run: r, ms: Date.now() - t0, score: s,
          fp: fpOf([...rows].sort((a, b) => a.name.localeCompare(b.name))),
        });
        summary.push(
          `T1 ${name} run${r}: recall ${pct(s.recall)} (${s.found}/${s.total}), ` +
            `aisle ${pct(s.aisleAccuracy)}, extras ${s.extras.length}, ${rawMs}ms`,
        );
      } catch (e) {
        if (e instanceof NotConfigured) throw e;
        records.push({ provider: name, task: "t1", run: r, ms: Date.now() - t0, score: null, error: String(e) });
      }
    }
    aggregate("t1", name);
  }
}

async function taskT2(providers: RunnerProvider[], runs: number): Promise<void> {
  const b64 = imgB64("data/stores/heb-001/map.png");
  for (const name of providers) {
    const p = makeProvider(name);
    for (let r = 0; r < runs; r++) {
      const t0 = Date.now();
      try {
        const { layout, rawMs } = await p.readMap(b64, "image/png");
        const ans: T2LayoutAnswer = {
          aisles: layout.aisles.map((a) => ({ n: a.n, x: a.x })),
          departments: layout.departments,
          entrances: layout.entrances,
        };
        const s = scoreT2(ans);
        records.push({
          provider: name, task: "t2", run: r, ms: Date.now() - t0, score: s,
          fp: fpOf(ans),
        });
        summary.push(
          `T2 ${name} run${r}: aisles ${s.aisleCount}${s.aisleCountOk ? "" : " (want 17)"} ` +
            `order ${s.orderOk ? "ok" : "BAD"} xErr ${s.meanXErrorPx.toFixed(0)}px ` +
            `depts ${s.deptsFound}/${s.deptsTotal} entr ${s.entrancesFound}/2, ${rawMs}ms`,
        );
        // Day 3: end-to-end — build store.json from `layout`, run routing A/B.
      } catch (e) {
        if (e instanceof NotConfigured) throw e;
        records.push({ provider: name, task: "t2", run: r, ms: Date.now() - t0, score: null, error: String(e) });
      }
    }
    aggregate("t2", name);
  }
}

async function taskT3(providers: RunnerProvider[], runs: number): Promise<void> {
  const cases = JSON.parse(
    readFileSync(join(root, "eval/cases/resolve.json"), "utf8"),
  ) as { cases: Array<{ input: string; expect: T3Expect }> };
  for (const name of providers) {
    const p = makeProvider(name);
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
        records.push({
          provider: name, task: "t3", run: r, ms: Date.now() - t0, score,
          fp: fpOf(answers),
        });
        summary.push(
          `T3 ${name} run${r}: top-1 ${pct(score.top1)} (${correct}/${cases.cases.length}), invented ${invented}`,
        );
      } catch (e) {
        if (e instanceof NotConfigured) throw e;
        records.push({ provider: name, task: "t3", run: r, ms: Date.now() - t0, score: null, error: String(e) });
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

async function main(): Promise<void> {
  const task = arg("task", "all");
  const providerArg = arg("provider", "both");
  const runs = Number(arg("runs", "3"));
  const providers: RunnerProvider[] =
    providerArg === "both"
      ? ["meta", "baseten"]
      : [providerArg as RunnerProvider];
  if (providerArg === "mock") {
    console.log("MOCK provider: returns ground truth to verify runner machinery. Not real results.\n");
  }

  try {
    if (task === "t1" || task === "all") await taskT1(providers, runs);
    if (task === "t2" || task === "all") await taskT2(providers, runs);
    if (task === "t3" || task === "all") await taskT3(providers, runs);
    if (task === "t4" || task === "all") await taskT4();
  } catch (e) {
    if (e instanceof NotConfigured) {
      console.error(`\nBLOCKED: ${e.message}\n`);
      console.error("Fill server/.dev.vars (keys never go in chat) and re-run.\n");
      process.exit(2);
    }
    throw e;
  }

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  mkdirSync(join(root, "eval/results"), { recursive: true });
  writeFileSync(
    join(root, `eval/results/${stamp}-${task}.json`),
    JSON.stringify(records, null, 1),
  );
  const md = [
    `# Eval ${stamp} — task=${task} provider=${providerArg} runs=${runs}`,
    "",
    ...summary.map((s) => `- ${s}`),
    "",
  ].join("\n");
  writeFileSync(join(root, `eval/results/${stamp}-summary.md`), md);
  console.log(md);
}

await main();
