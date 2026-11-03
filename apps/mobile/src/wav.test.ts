import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bytesToBase64,
  concatInt16,
  downmixToMono,
  encodeWav,
  resampleInt16,
} from "./wav.ts";

describe("encodeWav", () => {
  it("writes a correct 44-byte mono 16-bit header", () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768]);
    const wav = encodeWav(pcm, 16000);
    assert.equal(wav.length, 44 + 10);
    const tag = (off: number): string => String.fromCharCode(wav[off]!, wav[off + 1]!, wav[off + 2]!, wav[off + 3]!);
    assert.equal(tag(0), "RIFF");
    assert.equal(tag(8), "WAVE");
    assert.equal(tag(12), "fmt ");
    assert.equal(tag(36), "data");
    const view = new DataView(wav.buffer);
    assert.equal(view.getUint32(4, true), 36 + 10);
    assert.equal(view.getUint32(16, true), 16);
    assert.equal(view.getUint16(20, true), 1); // PCM
    assert.equal(view.getUint16(22, true), 1); // mono
    assert.equal(view.getUint32(24, true), 16000);
    assert.equal(view.getUint32(28, true), 32000); // byteRate
    assert.equal(view.getUint16(32, true), 2); // blockAlign
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(view.getUint32(40, true), 10);
    assert.deepEqual(
      [0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true)),
      [0, 1, -1, 32767, -32768],
    );
  });
});

describe("resampleInt16", () => {
  it("downsamples 48000 → 16000 at exact ratio", () => {
    const pcm = Int16Array.from({ length: 480 }, (_, i) => i);
    const out = resampleInt16(pcm, 48000, 16000);
    assert.equal(out.length, 160);
    assert.equal(out[0], 0);
    assert.equal(out[1], 3);
    assert.equal(out[159], 477);
  });

  it("handles non-integer ratios and equal rates", () => {
    const pcm = Int16Array.from({ length: 441 }, (_, i) => (i * 100) % 1000);
    const out = resampleInt16(pcm, 44100, 16000);
    assert.equal(out.length, Math.floor((441 * 16000) / 44100));
    const same = resampleInt16(pcm, 16000, 16000);
    assert.deepEqual([...same], [...pcm]);
    assert.notEqual(same, pcm);
  });
});

describe("concatInt16 + downmixToMono", () => {
  it("concatenates chunks and averages stereo to mono", () => {
    assert.deepEqual([...concatInt16([new Int16Array([1, 2]), new Int16Array([3])])], [1, 2, 3]);
    assert.deepEqual([...downmixToMono(new Int16Array([10, 20, 30, 40]), 2)], [15, 35]);
    assert.deepEqual([...downmixToMono(new Int16Array([7, 8]), 1)], [7, 8]);
  });
});

describe("bytesToBase64", () => {
  it("matches Buffer on RFC vectors and a long round trip", () => {
    assert.equal(bytesToBase64(new Uint8Array([])), "");
    assert.equal(bytesToBase64(new Uint8Array([0x4d])), "TQ==");
    assert.equal(bytesToBase64(new Uint8Array([0x4d, 0x61])), "TWE=");
    assert.equal(bytesToBase64(new Uint8Array([0x4d, 0x61, 0x6e])), "TWFu");
    const long = new Uint8Array(5000);
    for (let i = 0; i < long.length; i++) long[i] = (i * 37 + 11) % 256;
    const mine = bytesToBase64(long);
    assert.equal(mine, Buffer.from(long).toString("base64"));
    assert.deepEqual(new Uint8Array(Buffer.from(mine, "base64")), long);
  });
});
