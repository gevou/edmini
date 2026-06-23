import { describe, it, expect } from "vitest";
import { equalErrorRate, bootstrapEerCi, mulberry32 } from "../eer";

describe("mulberry32 (seeded PRNG for reproducible bootstrap)", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("different seeds give different sequences", () => {
    expect(mulberry32(1)()).not.toEqual(mulberry32(2)());
  });
});

describe("equalErrorRate (verification EER)", () => {
  it("is 0 when genuine and impostor scores are perfectly separable", () => {
    const r = equalErrorRate([0.8, 0.9], [0.1, 0.2]);
    expect(r.eer).toBe(0);
    // A threshold that splits them cleanly must sit between the two clusters.
    expect(r.threshold).toBeGreaterThan(0.2);
    expect(r.threshold).toBeLessThanOrEqual(0.8);
  });

  it("is 0.5 when genuine and impostor distributions are identical", () => {
    const r = equalErrorRate([0.3, 0.7], [0.3, 0.7]);
    expect(r.eer).toBeCloseTo(0.5, 6);
  });

  it("reports the trial counts it scored", () => {
    const r = equalErrorRate([0.8, 0.9, 0.95], [0.1, 0.2]);
    expect(r.genuineCount).toBe(3);
    expect(r.impostorCount).toBe(2);
  });

  it("lands the EER between the clean and fully-overlapped extremes for partial overlap", () => {
    // One impostor (0.85) intrudes into the genuine range; EER must be > 0 but < 0.5.
    const r = equalErrorRate([0.6, 0.7, 0.8, 0.9], [0.1, 0.2, 0.3, 0.85]);
    expect(r.eer).toBeGreaterThan(0);
    expect(r.eer).toBeLessThan(0.5);
  });

  it("throws on empty input rather than reporting a misleading 0", () => {
    expect(() => equalErrorRate([], [0.1])).toThrow(/empty/);
    expect(() => equalErrorRate([0.9], [])).toThrow(/empty/);
  });
});

describe("bootstrapEerCi (95% CI on the EER)", () => {
  it("is [0, 0] for perfectly separable data (every resample stays separable)", () => {
    const ci = bootstrapEerCi([0.8, 0.9, 0.95], [0.1, 0.2, 0.05], {
      iters: 200,
      rng: mulberry32(1),
    });
    expect(ci.lo).toBe(0);
    expect(ci.hi).toBe(0);
    expect(ci.iters).toBe(200);
  });

  it("brackets the point estimate with lo <= hi", () => {
    const genuine = [0.6, 0.7, 0.8, 0.9, 0.55];
    const impostor = [0.1, 0.2, 0.3, 0.85, 0.4];
    const ci = bootstrapEerCi(genuine, impostor, { iters: 500, rng: mulberry32(13) });
    expect(ci.lo).toBeLessThanOrEqual(ci.hi);
    expect(ci.lo).toBeGreaterThanOrEqual(0);
    expect(ci.hi).toBeLessThanOrEqual(1);
  });

  it("is reproducible given a seeded rng", () => {
    const g = [0.6, 0.7, 0.8, 0.9];
    const i = [0.1, 0.2, 0.3, 0.85];
    const a = bootstrapEerCi(g, i, { iters: 300, rng: mulberry32(99) });
    const b = bootstrapEerCi(g, i, { iters: 300, rng: mulberry32(99) });
    expect(a).toEqual(b);
  });
});
