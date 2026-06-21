import { describe, it, expect } from "vitest";
import { l2normalize, cosineSimilarity } from "../cosine";

const v = (...xs: number[]) => Float32Array.from(xs);

describe("l2normalize", () => {
  it("scales to unit length", () => {
    const u = l2normalize(v(3, 4));
    expect(u[0]).toBeCloseTo(0.6, 6);
    expect(u[1]).toBeCloseTo(0.8, 6);
  });

  it("returns zeros for a zero vector (no divide-by-zero)", () => {
    expect(Array.from(l2normalize(v(0, 0, 0)))).toEqual([0, 0, 0]);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical direction regardless of magnitude", () => {
    expect(cosineSimilarity(v(1, 2, 3), v(2, 4, 6))).toBeCloseTo(1, 6);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity(v(1, 0), v(0, 1))).toBeCloseTo(0, 6);
  });

  it("is -1 for opposite direction", () => {
    expect(cosineSimilarity(v(1, 1), v(-1, -1))).toBeCloseTo(-1, 6);
  });

  it("treats a zero-norm input as no match (0)", () => {
    expect(cosineSimilarity(v(0, 0), v(1, 1))).toBe(0);
  });

  it("throws on dimension mismatch (stale enrollment guard)", () => {
    expect(() => cosineSimilarity(v(1, 2), v(1, 2, 3))).toThrow(/dim mismatch/);
  });
});
