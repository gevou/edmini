import { describe, it, expect } from "vitest";
import { createFbankExtractor, applyCMN, DEFAULT_FBANK_CONFIG } from "../fbank";

/** A pure sine tone at `freq` Hz. */
function tone(freq: number, ms: number, sr = 16000): Float32Array {
  const n = Math.round((ms / 1000) * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

describe("fbank extractor", () => {
  it("produces 80-dim frames at ~10ms shift", () => {
    const fb = createFbankExtractor();
    const frames = fb.compute(tone(440, 1000));
    expect(fb.numMelBins).toBe(80);
    expect(frames[0].length).toBe(80);
    // 1000ms, 25ms window, 10ms shift → ~98 frames.
    expect(frames.length).toBeGreaterThan(90);
    expect(frames.length).toBeLessThan(102);
  });

  it("returns no frames when input is shorter than one window", () => {
    const fb = createFbankExtractor();
    expect(fb.compute(new Float32Array(100))).toHaveLength(0);
  });

  it("puts energy in higher mel bins for higher tones", () => {
    const fb = createFbankExtractor();
    const peakBin = (freq: number) => {
      const f = fb.compute(tone(freq, 300))[5];
      let best = 0;
      for (let i = 1; i < f.length; i++) if (f[i] > f[best]) best = i;
      return best;
    };
    expect(peakBin(3000)).toBeGreaterThan(peakBin(300));
  });

  it("CMN centers each dimension on ~zero mean over time", () => {
    const fb = createFbankExtractor(DEFAULT_FBANK_CONFIG);
    const frames = fb.compute(tone(440, 500));
    applyCMN(frames);
    const dim = 0;
    let mean = 0;
    for (const f of frames) mean += f[dim];
    mean /= frames.length;
    expect(mean).toBeCloseTo(0, 5);
  });
});
