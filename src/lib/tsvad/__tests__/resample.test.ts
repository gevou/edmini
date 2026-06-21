import { describe, it, expect } from "vitest";
import { resampleLinear } from "../resample";

describe("resampleLinear", () => {
  it("returns the same array when rates match", () => {
    const x = Float32Array.from([1, 2, 3]);
    expect(resampleLinear(x, 16000, 16000)).toBe(x);
  });

  it("downsamples 48k→16k by ~1/3 length", () => {
    const x = new Float32Array(4800); // 100ms @ 48k
    const out = resampleLinear(x, 48000, 16000);
    expect(out.length).toBe(1600); // 100ms @ 16k
  });

  it("preserves endpoints and interpolates linearly", () => {
    const x = Float32Array.from([0, 1, 2, 3]); // a ramp
    const out = resampleLinear(x, 4, 8); // upsample 2x
    expect(out[0]).toBeCloseTo(0, 5);
    // midpoint between samples should land on the ramp.
    expect(out[1]).toBeCloseTo(0.5, 5);
    expect(out[out.length - 1]).toBeCloseTo(3, 5);
  });

  it("handles empty input", () => {
    expect(resampleLinear(new Float32Array(0), 48000, 16000)).toHaveLength(0);
  });
});
