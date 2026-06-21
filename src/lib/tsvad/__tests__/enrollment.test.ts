import { describe, it, expect } from "vitest";
import { createEnrollmentAccumulator } from "../enrollment";
import { cosineSimilarity } from "../cosine";

const v = (...xs: number[]) => Float32Array.from(xs);

describe("enrollment accumulator", () => {
  it("returns null below minWindows", () => {
    const acc = createEnrollmentAccumulator(2);
    acc.add(v(1, 0));
    expect(acc.count).toBe(1);
    expect(acc.build(3)).toBeNull();
  });

  it("builds an L2-normalized centroid", () => {
    const acc = createEnrollmentAccumulator(2);
    acc.add(v(1, 0));
    acc.add(v(0, 1));
    const e = acc.build();
    expect(e).not.toBeNull();
    // mean of the two unit axes points at 45°, normalized to unit length.
    expect(e!.centroid[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(e!.centroid[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(e!.windowCount).toBe(2);
    expect(e!.dim).toBe(2);
  });

  it("normalizes per-window so a loud window can't dominate", () => {
    const acc = createEnrollmentAccumulator(2);
    acc.add(v(1000, 0)); // huge magnitude, same direction as (1,0)
    acc.add(v(0, 1));
    const e = acc.build()!;
    // If magnitude leaked in, the centroid would sit almost on the x-axis. Per-window
    // normalization keeps it balanced at 45°.
    expect(e.centroid[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(e.centroid[1]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("centroid scores ~1 against an enrollment-direction probe", () => {
    const acc = createEnrollmentAccumulator(3);
    acc.add(v(2, 1, 0));
    acc.add(v(2, 1, 0));
    const e = acc.build()!;
    expect(cosineSimilarity(e.centroid, v(2, 1, 0))).toBeCloseTo(1, 6);
  });

  it("throws on dim mismatch", () => {
    const acc = createEnrollmentAccumulator(2);
    expect(() => acc.add(v(1, 2, 3))).toThrow(/dim mismatch/);
  });

  it("reset clears accumulated state", () => {
    const acc = createEnrollmentAccumulator(2);
    acc.add(v(1, 0));
    acc.reset();
    expect(acc.count).toBe(0);
    expect(acc.build()).toBeNull();
  });
});
