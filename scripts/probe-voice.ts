/**
 * Voice probe — the ONLY live STT call. Validates a local WAV with the same
 * header check as /voice-list, sends ONE request through the same
 * transcribeVoice code path, and prints status, top-level response keys,
 * and the transcript (or the error body truncated to 300 chars).
 *
 * Run: node scripts/probe-voice.ts <file.wav>
 *      node scripts/probe-voice.ts --make-silence <out.wav>   (no network)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWavHeader, transcribeVoice, type SttInspect, type WavInfo } from "../server/src/voice.ts";
import { encodeWav } from "../apps/mobile/src/wav.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg: string, code = 2): never => {
  console.error(msg);
  process.exit(code);
  throw new Error("unreachable");
};

const argv = process.argv.slice(2);
if (argv[0] === "--make-silence") {
  const out = argv[1] ?? fail("usage: node scripts/probe-voice.ts --make-silence <out.wav>");
  const silence = encodeWav(new Int16Array(16000), 16000);
  writeFileSync(out, silence);
  console.log(`wrote ${out} (${silence.length} bytes: 44 header + 1 s of 16 kHz silence)`);
  process.exit(0);
}

const wavPath: string =
  argv.find((a) => !a.startsWith("--")) ??
  fail("usage: node scripts/probe-voice.ts <file.wav> [--make-silence <out.wav>]");
if (!existsSync(wavPath)) fail(`no such file: ${wavPath}`);
const raw = readFileSync(wavPath);
const wav = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
const info: WavInfo = (() => {
  try {
    return parseWavHeader(wav);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
})();
console.log(`wav: rate=${info.sampleRate} dataBytes=${info.dataBytes} sec=${info.durationSec.toFixed(2)}`);

// Key loading mirrors scripts/ingest-try.ts: server/.dev.vars, env wins.
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

const t0 = Date.now();
let last: SttInspect | null = null;
try {
  const { transcript } = await transcribeVoice(wav, env, { inspect: (i) => (last = i) });
  console.log(`status=${last!.status}`);
  console.log(`keys=[${last!.keys.join(", ") || "none"}]`);
  console.log(`transcript=${transcript}`);
} catch (e) {
  if (last) {
    const seen: SttInspect = last;
    console.log(`status=${seen.status}`);
    console.log(`keys=[${seen.keys.join(", ") || "none"}]`);
    console.log(`body=${seen.snippet}`);
  }
  console.log(`error=${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
console.log(`ms=${Date.now() - t0}`);
