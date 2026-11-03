/**
 * Pure WAV helpers for hold-to-talk: Int16 mic chunks → 16/24 kHz mono
 * 16-bit WAV bytes + base64. No dependencies, no React Native imports —
 * shared by the app and scripts/probe-voice.ts.
 */

export const MIN_VOICE_SECONDS = 0.3;
export const MAX_VOICE_SECONDS = 30;
/** sample rates the server accepts as-is; anything else resamples to 16000 */
export const VOICE_NATIVE_RATES = [16000, 24000] as const;

/** Concatenate Int16 PCM chunks into one array. Pure — returns a new array. */
export function concatInt16(chunks: Int16Array[]): Int16Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Int16Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Average interleaved channels down to mono. channels=1 returns a copy.
 * Pure — returns a new array.
 */
export function downmixToMono(frames: Int16Array, channels: number): Int16Array {
  if (channels <= 1) return frames.slice();
  const n = Math.floor(frames.length / channels);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += frames[i * channels + c]!;
    out[i] = Math.round(sum / channels);
  }
  return out;
}

/**
 * Linear-interpolation resample. Equal rates return a copy.
 * Pure — returns a new array.
 */
export function resampleInt16(pcm: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return pcm.slice();
  if (pcm.length === 0 || fromRate <= 0 || toRate <= 0) return new Int16Array(0);
  const outLen = Math.floor((pcm.length * toRate) / fromRate);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = (i * fromRate) / toRate;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const s0 = pcm[i0]!;
    const s1 = i0 + 1 < pcm.length ? pcm[i0 + 1]! : s0;
    out[i] = Math.round(s0 + (s1 - s0) * frac);
  }
  return out;
}

/** Wrap mono Int16 PCM in a 44-byte WAV header. Pure — returns new bytes. */
export function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const tag = (off: number, s: string): void => {
    for (let i = 0; i < 4; i++) out[off + i] = s.charCodeAt(i);
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bitsPerSample
  tag(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i]!, true);
  return out;
}

const B64ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64 encode without Buffer (Hermes has none). Pure. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;
    parts.push(
      B64ABC[(n >> 18) & 63]! +
        B64ABC[(n >> 12) & 63]! +
        (i + 1 < bytes.length ? B64ABC[(n >> 6) & 63]! : "=") +
        (i + 2 < bytes.length ? B64ABC[n & 63]! : "="),
    );
  }
  return parts.join("");
}
