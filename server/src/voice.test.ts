import { describe, it } from "node:test";
import assert from "node:assert/strict";
import app from "./index.ts";
import {
  MAX_AUDIO_BYTES,
  MAX_VOICE_BODY_CHARS,
  VOICE_STT_WIRE,
  VoiceError,
  handleVoiceText,
  parseWavHeader,
} from "./voice.ts";

interface WavOpts {
  rate?: number;
  channels?: number;
  bits?: number;
  format?: number;
  seconds?: number;
  riff?: boolean;
}

/** Minimal PCM WAV: 44-byte header + zeroed data. */
function wav(o: WavOpts = {}): Uint8Array {
  const rate = o.rate ?? 16000;
  const channels = o.channels ?? 1;
  const bits = o.bits ?? 16;
  const seconds = o.seconds ?? 1;
  const dataBytes = Math.floor(seconds * rate * channels * (bits / 8));
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const tag = (off: number, s: string): void => {
    for (let i = 0; i < 4; i++) out[off + i] = s.charCodeAt(i);
  };
  tag(0, o.riff === false ? "RIFX" : "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, o.format ?? 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, Math.floor((rate * channels * bits) / 8), true);
  view.setUint16(32, Math.floor((channels * bits) / 8), true);
  view.setUint16(34, bits, true);
  tag(36, "data");
  view.setUint32(40, dataBytes, true);
  return out;
}

const bodyOf = (bytes: Uint8Array): string =>
  JSON.stringify({ audio: { mime: "audio/wav", b64: Buffer.from(bytes).toString("base64") } });

const asFetch = (fn: (url: string, init: { signal?: AbortSignal }) => Promise<unknown>): typeof fetch =>
  fn as unknown as typeof fetch;

describe("parseWavHeader", () => {
  it("accepts 16 kHz mono 16-bit PCM and derives duration", () => {
    const info = parseWavHeader(wav({ rate: 16000, seconds: 2 }));
    assert.equal(info.sampleRate, 16000);
    assert.equal(info.channels, 1);
    assert.equal(info.bitsPerSample, 16);
    assert.equal(info.dataBytes, 64000);
    assert.equal(info.durationSec, 2);
  });

  it("accepts 24 kHz", () => {
    const info = parseWavHeader(wav({ rate: 24000, seconds: 1 }));
    assert.equal(info.sampleRate, 24000);
    assert.equal(info.dataBytes, 48000);
  });

  it("rejects 44.1 kHz and 48 kHz", () => {
    for (const rate of [44100, 48000]) {
      assert.throws(() => parseWavHeader(wav({ rate })), (e: unknown) => {
        assert.ok(e instanceof VoiceError && e.status === 400);
        assert.ok((e as Error).message.includes(String(rate)));
        return true;
      });
    }
  });

  it("rejects stereo", () => {
    assert.throws(() => parseWavHeader(wav({ channels: 2 })), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.status === 400);
      assert.ok((e as Error).message.includes("mono"));
      return true;
    });
  });

  it("rejects 8-bit", () => {
    assert.throws(() => parseWavHeader(wav({ bits: 8 })), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.status === 400);
      assert.ok((e as Error).message.includes("16-bit"));
      return true;
    });
  });

  it("rejects float (format 3)", () => {
    assert.throws(() => parseWavHeader(wav({ format: 3 })), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.status === 400);
      assert.ok((e as Error).message.includes("PCM"));
      return true;
    });
  });

  it("rejects non-RIFF and truncated input", () => {
    for (const bad of [wav({ riff: false }), new Uint8Array(10), new Uint8Array(0)]) {
      assert.throws(() => parseWavHeader(bad), (e: unknown) => {
        assert.ok(e instanceof VoiceError && e.status === 400);
        assert.ok((e as Error).message.includes("WAV"));
        return true;
      });
    }
  });

  it("rejects recordings over 30 s with 413", () => {
    assert.throws(() => parseWavHeader(wav({ seconds: 31 })), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.status === 413);
      return true;
    });
  });

  it("rejects recordings under 0.3 s with 400", () => {
    assert.throws(() => parseWavHeader(wav({ seconds: 0.1 })), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.status === 400);
      assert.ok((e as Error).message.includes("too short"));
      return true;
    });
  });
});

describe("POST /voice-list", () => {
  it("rejects oversized bodies before parsing", async () => {
    const res = await app.request(
      "http://x/voice-list",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(MAX_VOICE_BODY_CHARS + 1),
      },
      {},
    );
    assert.equal(res.status, 413);
    assert.ok(((await res.json()) as { error: string }).error.includes("too large"));
  });

  it("rejects non-WAV mime and oversize audio without calling upstream", async () => {
    const calls: string[] = [];
    const spy = asFetch(async (url) => {
      calls.push(url);
      return { status: 200, text: async () => "{}" };
    });
    await assert.rejects(
      handleVoiceText(
        JSON.stringify({ audio: { mime: "audio/mp3", b64: "aGk=" } }),
        { MODEL_API_KEY: "k" },
        { fetchImpl: spy },
      ),
      (e: unknown) => e instanceof VoiceError && e.status === 400,
    );
    const big = "A".repeat(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 8);
    await assert.rejects(
      handleVoiceText(
        JSON.stringify({ audio: { mime: "audio/wav", b64: big } }),
        { MODEL_API_KEY: "k" },
        { fetchImpl: spy },
      ),
      (e: unknown) => e instanceof VoiceError && e.status === 413,
    );
    assert.deepEqual(calls, []);
  });
});

describe("transcribeVoice (mocked upstream)", () => {
  it("ok → transcript; posts to /v1/asr/transcribe with a Bearer key", async () => {
    let seenUrl = "";
    let seenAuth = "";
    let seenBody: unknown = null;
    const ok = asFetch(async (url, init) => {
      seenUrl = url;
      seenAuth = (init as { headers: Record<string, string> }).headers.Authorization;
      seenBody = (init as { body: unknown }).body;
      return { status: 200, text: async () => JSON.stringify({ [VOICE_STT_WIRE.transcriptField]: "milk eggs" }) };
    });
    const out = await handleVoiceText(bodyOf(wav({ seconds: 1 })), { MODEL_API_KEY: "k" }, { fetchImpl: ok });
    assert.equal(out.status, 200);
    assert.deepEqual(out.json, { transcript: "milk eggs", provider: "meta" });
    assert.ok(seenUrl.endsWith("/v1/asr/transcribe"), seenUrl);
    assert.equal(seenAuth, "Bearer k");
    assert.ok(seenBody instanceof FormData);
    assert.ok(out.log.includes("bytes="));
    assert.ok(!out.log.includes("milk"));
  });

  it("trims trailing dots and whitespace from transcripts", async () => {
    for (const [raw, want] of [
      ["  cereal..  ", "cereal"],
      ["milk eggs.", "milk eggs"],
      ["Mr. Smith", "Mr. Smith"],
      ["2.5", "2.5"],
    ] as const) {
      const ok = asFetch(async () => ({
        status: 200,
        text: async () => JSON.stringify({ [VOICE_STT_WIRE.transcriptField]: raw }),
      }));
      const out = await handleVoiceText(
        bodyOf(wav({ seconds: 1 })),
        { MODEL_API_KEY: "k" },
        { fetchImpl: ok },
      );
      assert.equal(out.json.transcript, want, JSON.stringify(raw));
    }
    const dots = asFetch(async () => ({
      status: 200,
      text: async () => JSON.stringify({ [VOICE_STT_WIRE.transcriptField]: "..." }),
    }));
    await assert.rejects(
      handleVoiceText(bodyOf(wav({ seconds: 1 })), { MODEL_API_KEY: "k" }, { fetchImpl: dots }),
      (e: unknown) => e instanceof VoiceError && e.status === 502,
    );
  });

  it("non-200 → 502 and inspect sees status/keys/snippet", async () => {
    const seen: Array<{ status: number; keys: string[]; snippet: string }> = [];
    const bad = asFetch(async () => ({ status: 500, text: async () => '{"error":"boom"}' }));
    await assert.rejects(
      handleVoiceText(bodyOf(wav({ seconds: 1 })), { MODEL_API_KEY: "k" }, { fetchImpl: bad, inspect: (i) => seen.push(i) }),
      (e: unknown) => {
        assert.ok(e instanceof VoiceError && e.status === 502);
        assert.ok((e as Error).message.includes("upstream 500"));
        return true;
      },
    );
    assert.deepEqual(seen, [{ status: 500, keys: ["error"], snippet: '{"error":"boom"}' }]);
  });

  it("timeout → 504", async () => {
    const hang = asFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );
    await assert.rejects(
      handleVoiceText(bodyOf(wav({ seconds: 1 })), { MODEL_API_KEY: "k" }, { fetchImpl: hang, timeoutMs: 30 }),
      (e: unknown) => e instanceof VoiceError && e.status === 504,
    );
  });

  it("missing key and empty transcripts → 502, never the key in logs", async () => {
    await assert.rejects(handleVoiceText(bodyOf(wav({ seconds: 1 })), {}, {}), (e: unknown) => {
      assert.ok(e instanceof VoiceError && e.status === 502);
      assert.ok((e as Error).message.includes("not configured"));
      return true;
    });
    const empty = asFetch(async () => ({ status: 200, text: async () => '{"transcript":"  "}' }));
    await assert.rejects(
      handleVoiceText(bodyOf(wav({ seconds: 1 })), { MODEL_API_KEY: "k" }, { fetchImpl: empty }),
      (e: unknown) => e instanceof VoiceError && e.status === 502,
    );
  });
});
