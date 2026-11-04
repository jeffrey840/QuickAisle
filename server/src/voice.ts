import { metaBaseUrl } from "./providers/meta.ts";
import type { ProviderEnv } from "./providers/index.ts";

/**
 * POST /voice-list: spoken list audio → transcript (Meta STT, server-side
 * only — the key never leaves the worker). The app sends 16/24 kHz mono
 * 16-bit WAV; the transcript goes into the list text box and normal
 * matching/routing is unchanged.
 */

/**
 * STT WIRE — CONFIRMED by scripts/probe-voice.ts against the live API on
 * 2026-11-03 (status 200, keys included "transcript"). The route, the STT
 * call, and the probe all read this block; change names HERE ONLY.
 */
export const VOICE_STT_WIRE = {
  /** multipart field carrying the JSON params below */
  jsonPart: "request",
  /** multipart field carrying the WAV file bytes */
  audioPart: "audio",
  /** response JSON field holding the transcript text */
  transcriptField: "transcript",
} as const;

/** JSON params sent in the VOICE_STT_WIRE.jsonPart multipart field. */
export const VOICE_STT_PARAMS = {
  model: "muse-voice-transcribe-1.0",
  audioEncoding: "WAV",
  mode: "PUSH_TO_TALK",
} as const;

export const MAX_AUDIO_BYTES = 1_572_864; // 1.5 MB decoded
/**
 * Raw body cap, checked before JSON parse. 1.5 MB decoded audio is
 * ceil(1572864 B → base64) = 2097152 chars, plus ~100 KB headroom for the
 * JSON envelope and whitespace. (The brief's "~1.6M" can't hold 1.5 MB
 * decoded — that would 413 any 24 kHz clip over ~23 s — so this is sized
 * from the audio cap instead.)
 */
export const MAX_VOICE_BODY_CHARS = 2_200_000;
export const VOICE_TIMEOUT_MS = 20_000; // STT call, no fallback provider
export const MIN_VOICE_SEC = 0.3;
export const MAX_VOICE_SEC = 30;
export const VOICE_RATES = [16000, 24000] as const;

export class VoiceError extends Error {
  readonly status: 400 | 413 | 502 | 504;
  constructor(status: 400 | 413 | 502 | 504, message: string) {
    super(message);
    this.name = "VoiceError";
    this.status = status;
  }
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  /** from the data chunk size */
  durationSec: number;
}

const ascii = (b: Uint8Array, off: number): string =>
  String.fromCharCode(b[off]!, b[off + 1]!, b[off + 2]!, b[off + 3]!);

const u32 = (b: Uint8Array, off: number): number =>
  b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | b[off + 3]! * 0x1000000;

const u16 = (b: Uint8Array, off: number): number => b[off]! | (b[off + 1]! << 8);

/**
 * Validate a WAV header (RIFF/WAVE, PCM fmt, mono 16-bit, 16/24 kHz) and
 * derive duration from the data chunk. Pure — no network, no decoding.
 * Extra chunks (LIST, JUNK, …) before fmt/data are skipped.
 */
export function parseWavHeader(bytes: Uint8Array): WavInfo {
  if (bytes.length < 12 || ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WAVE") {
    throw new VoiceError(400, "audio is not a WAV file (missing RIFF/WAVE header)");
  }
  let fmt: Uint8Array | null = null;
  let dataSize = -1;
  let dataOff = -1;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = ascii(bytes, off);
    const size = u32(bytes, off + 4);
    const start = off + 8;
    if (start + size > bytes.length) {
      throw new VoiceError(400, "audio is not a WAV file (chunk runs past the end)");
    }
    if (id === "fmt ") fmt = bytes.slice(start, start + size);
    if (id === "data" && dataSize < 0) {
      dataSize = size;
      dataOff = start;
    }
    off = start + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || fmt.length < 16) {
    throw new VoiceError(400, "WAV is missing the fmt chunk");
  }
  const format = u16(fmt, 0);
  if (format !== 1) {
    throw new VoiceError(400, `WAV must be PCM (format 1), got format ${format}`);
  }
  const channels = u16(fmt, 2);
  if (channels !== 1) {
    throw new VoiceError(400, `WAV must be mono (1 channel), got ${channels}`);
  }
  const sampleRate = u32(fmt, 4);
  if (sampleRate !== 16000 && sampleRate !== 24000) {
    throw new VoiceError(400, `WAV sample rate must be 16000 or 24000 Hz, got ${sampleRate}`);
  }
  const bits = u16(fmt, 14);
  if (bits !== 16) {
    throw new VoiceError(400, `WAV must be 16-bit, got ${bits}-bit`);
  }
  if (dataSize < 0 || dataOff < 0) {
    throw new VoiceError(400, "WAV is missing the data chunk");
  }
  if (dataOff + dataSize > bytes.length) {
    throw new VoiceError(400, "WAV data chunk is truncated");
  }
  const durationSec = dataSize / (sampleRate * 2);
  if (durationSec < MIN_VOICE_SEC) {
    throw new VoiceError(
      400,
      `recording too short (${durationSec.toFixed(2)} s; minimum ${MIN_VOICE_SEC} s)`,
    );
  }
  if (durationSec > MAX_VOICE_SEC) {
    throw new VoiceError(
      413,
      `recording too long (${durationSec.toFixed(2)} s; maximum ${MAX_VOICE_SEC} s)`,
    );
  }
  return { sampleRate, channels, bitsPerSample: bits, dataBytes: dataSize, durationSec };
}

/** base64 → bytes without Buffer (workers have atob, not Buffer). */
function b64ToBytes(b64: string): Uint8Array {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new VoiceError(400, "b64 is not valid base64");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function validateVoiceRequest(body: unknown): { b64: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new VoiceError(400, "body must be a JSON object");
  }
  const audio = (body as Record<string, unknown>).audio as Record<string, unknown> | undefined;
  if (!audio || typeof audio !== "object" || Array.isArray(audio)) {
    throw new VoiceError(400, "audio must be {mime, b64}");
  }
  if (audio.mime !== "audio/wav") {
    throw new VoiceError(400, 'mime must be audio/wav');
  }
  if (typeof audio.b64 !== "string" || !audio.b64.trim()) {
    throw new VoiceError(400, "b64 must be a non-empty base64 string");
  }
  const b64 = audio.b64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]*$/.test(b64)) {
    throw new VoiceError(400, "b64 is not valid base64");
  }
  const bytes = Math.ceil((b64.length * 3) / 4);
  if (bytes > MAX_AUDIO_BYTES) {
    throw new VoiceError(413, `audio exceeds 1.5 MB (${bytes} bytes)`);
  }
  return { b64 };
}

export interface SttInspect {
  status: number;
  /** top-level response keys (empty when the body isn't JSON) */
  keys: string[];
  /** first 300 chars of the raw response body */
  snippet: string;
}

export interface TranscribeOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** observer for the probe: raw status/keys/snippet before mapping */
  inspect?: (info: SttInspect) => void;
}

/**
 * One Meta STT call over multipart/form-data. Server-side only (Bearer
 * MODEL_API_KEY), 20 s timeout, no fallback provider. Throws VoiceError
 * with 502 (upstream) or 504 (timeout). Never includes audio or the key
 * in messages.
 */
export async function transcribeVoice(
  wav: Uint8Array,
  env: ProviderEnv,
  opts: TranscribeOpts = {},
): Promise<{ transcript: string; latencyMs: number }> {
  const key = env.MODEL_API_KEY;
  if (!key) throw new VoiceError(502, "voice transcription is not configured on this server");
  const timeoutMs = opts.timeoutMs ?? VOICE_TIMEOUT_MS;
  const form = new FormData();
  form.append(
    VOICE_STT_WIRE.jsonPart,
    new Blob([JSON.stringify(VOICE_STT_PARAMS)], { type: "application/json" }),
  );
  // Copy into a fresh ArrayBuffer: the input may be a view (Buffer slice).
  const buf = new ArrayBuffer(wav.length);
  new Uint8Array(buf).set(wav);
  form.append(VOICE_STT_WIRE.audioPart, new Blob([buf], { type: "audio/wav" }), "audio.wav");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${metaBaseUrl(env)}/v1/asr/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new VoiceError(504, "transcription timed out — try again");
    }
    throw new VoiceError(502, "couldn't transcribe — try again");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  opts.inspect?.({
    status: res.status,
    keys: json && typeof json === "object" && !Array.isArray(json) ? Object.keys(json) : [],
    snippet: text.slice(0, 300),
  });
  if (res.status !== 200) {
    throw new VoiceError(502, `transcription failed (upstream ${res.status})`);
  }
  const transcript = (json as Record<string, unknown> | null)?.[VOICE_STT_WIRE.transcriptField];
  if (typeof transcript !== "string" || !transcript.trim()) {
    throw new VoiceError(502, "transcription returned no text — try again");
  }
  // Dictation often ends in filler dots ("cereal..") — strip those and any
  // whitespace they reveal, so the text box gets clean list lines.
  const cleaned = transcript.trim().replace(/[.\s]+$/, "");
  if (!cleaned) {
    throw new VoiceError(502, "transcription returned no text — try again");
  }
  return { transcript: cleaned, latencyMs: Date.now() - t0 };
}

export interface VoiceOk {
  status: 200;
  json: { transcript: string; provider: string };
  /** counts only — never audio, transcripts, or keys */
  log: string;
}

export async function handleVoiceText(
  text: string,
  env: ProviderEnv,
  opts: TranscribeOpts = {},
): Promise<VoiceOk> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new VoiceError(400, "body must be JSON");
  }
  const { b64 } = validateVoiceRequest(body);
  const wav = b64ToBytes(b64);
  const info = parseWavHeader(wav);
  const t0 = Date.now();
  const { transcript } = await transcribeVoice(wav, env, opts);
  const log =
    `[voice] bytes=${wav.length} sec=${info.durationSec.toFixed(1)} rate=${info.sampleRate} ` +
    `provider=meta latencyMs=${Date.now() - t0}`;
  return { status: 200, json: { transcript, provider: "meta" }, log };
}
