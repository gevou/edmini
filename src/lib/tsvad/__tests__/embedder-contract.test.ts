/**
 * Contract/integration test (edmini-xz9): exercises the REAL feature path — fbank → ONNX Runtime →
 * cosine — against a committed synthetic CAM++ stand-in (scripts/fixtures/synthetic_campplus.onnx,
 * same I/O contract: feats[1,T,80] → embs[1,192]). No network, no real weights.
 *
 * This guards the integration contract embedder-onnx.ts depends on (input name, TF layout, output
 * dim) and proves the pipeline discriminates consistent spectra. It does NOT measure CAM++ accuracy —
 * that needs the real model + real speech (run `pnpm tsvad:validate <model> <wavDir>` locally).
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as ort from "onnxruntime-node";
import { join } from "node:path";
import { createFbankExtractor, applyCMN } from "../fbank";
import { cosineSimilarity } from "../cosine";

const MODEL = join(process.cwd(), "scripts/fixtures/synthetic_campplus.onnx");
const SR = 16000;
const fbank = createFbankExtractor();

function synthVoice(voiceId: number, utt: number, ms = 1000): Float32Array {
  const n = Math.round((ms / 1000) * SR);
  const out = new Float32Array(n);
  const f0 = 100 + voiceId * 35;
  const formants = [500 + voiceId * 180, 1500 + voiceId * 220, 2500 + voiceId * 200];
  const jitter = 1 + (utt - 1) * 0.01;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let h = 1; h <= 18; h++) {
      const freq = f0 * h * jitter;
      let amp = 1 / h;
      for (const fmt of formants) amp *= 1 / (1 + ((freq - fmt) / 220) ** 2);
      s += amp * Math.sin(2 * Math.PI * freq * t);
    }
    out[i] = s * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) * 0.2;
  }
  return out;
}

async function embed(session: ort.InferenceSession, samples: Float32Array): Promise<Float32Array> {
  const frames = fbank.compute(samples);
  applyCMN(frames);
  const T = frames.length;
  const F = fbank.numMelBins;
  const flat = new Float32Array(T * F);
  for (let t = 0; t < T; t++) flat.set(frames[t], t * F);
  const tensor = new ort.Tensor("float32", flat, [1, T, F]);
  const out = await session.run({ feats: tensor });
  return (out[session.outputNames[0]].data as Float32Array).slice();
}

describe("embedder contract (fbank → ONNX → cosine)", () => {
  let session: ort.InferenceSession;
  beforeAll(async () => {
    session = await ort.InferenceSession.create(MODEL);
  });

  it("exposes the CAM++ I/O contract", () => {
    expect(session.inputNames).toContain("feats");
    expect(session.outputNames[0]).toBe("embs");
  });

  it("produces a 192-d embedding", async () => {
    const e = await embed(session, synthVoice(0, 1));
    expect(e.length).toBe(192);
  });

  it("scores identical audio at ~1.0", async () => {
    const a = await embed(session, synthVoice(1, 1));
    const b = await embed(session, synthVoice(1, 1));
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it("separates speakers: same-voice cosine > different-voice cosine", async () => {
    const v0a = await embed(session, synthVoice(0, 1));
    const v0b = await embed(session, synthVoice(0, 2));
    const v3 = await embed(session, synthVoice(3, 1));
    const same = cosineSimilarity(v0a, v0b);
    const diff = cosineSimilarity(v0a, v3);
    expect(same).toBeGreaterThan(diff);
    expect(same - diff).toBeGreaterThan(0.03);
  });
});
