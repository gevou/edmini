import { describe, it, expect } from "vitest";
import { rms, dbfs, isVoiced } from "../level";

const constant = (v: number, n: number) => new Float32Array(n).fill(v);

describe("level helpers", () => {
  it("rms of silence is 0", () => {
    expect(rms(new Float32Array(100))).toBe(0);
  });

  it("rms of a constant signal equals its magnitude", () => {
    expect(rms(constant(0.5, 256))).toBeCloseTo(0.5, 6);
  });

  it("rms of empty input is 0 (no NaN)", () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it("dbfs floors silence rather than returning -Infinity", () => {
    expect(dbfs(0)).toBe(-100);
    expect(dbfs(1)).toBeCloseTo(0, 6);
    expect(dbfs(0.5)).toBeCloseTo(-6.02, 1);
  });

  it("isVoiced rejects silence and accepts loud-enough audio", () => {
    expect(isVoiced(new Float32Array(256), 0.01)).toBe(false);
    expect(isVoiced(constant(0.1, 256), 0.01)).toBe(true);
  });
});
