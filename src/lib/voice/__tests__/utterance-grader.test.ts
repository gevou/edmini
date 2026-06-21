import { describe, it, expect } from "vitest";
import { createUtteranceGrader } from "../utterance-grader";

function grade(scores: Array<[number | null, number]>, policy?: Parameters<typeof createUtteranceGrader>[0]) {
  const g = createUtteranceGrader(policy);
  g.begin();
  for (const [raw, level] of scores) g.addScore(raw, level);
  return g.end();
}

describe("utterance-grader", () => {
  it("responds when mean cosine over voiced windows clears the threshold", () => {
    const r = grade([[0.5, 0.2], [0.55, 0.2], [0.6, 0.2], [0.5, 0.2], [0.52, 0.2]]);
    expect(r.decision).toBe("respond");
    expect(r.confidence).toBeGreaterThan(0.45);
    expect(r.voicedWindows).toBe(5);
  });
  it("suppresses when the mean is below the threshold (a different speaker)", () => {
    const r = grade([[0.05, 0.2], [-0.02, 0.2], [0.1, 0.2], [0.0, 0.2], [0.08, 0.2]]);
    expect(r.decision).toBe("suppress");
  });
  it("ignores silence windows (below the voiced floor) in the mean", () => {
    const r = grade([
      [0.05, 0.2], [0.05, 0.2], [0.05, 0.2], [0.05, 0.2], [0.05, 0.2],
      [0.9, 0.001], [0.9, 0.001], [0.9, 0.001],
    ]);
    expect(r.decision).toBe("suppress");
    expect(r.voicedWindows).toBe(5);
  });
  it("allow-if-uncertain: too few voiced windows → respond (don't refuse a quick 'stop')", () => {
    const r = grade([[0.1, 0.2], [0.05, 0.2]]);
    expect(r.decision).toBe("respond");
  });
  it("pass-through: not enrolled (all raw null) → respond", () => {
    const r = grade([[null, 0.2], [null, 0.2], [null, 0.2], [null, 0.2], [null, 0.2]]);
    expect(r.decision).toBe("respond");
  });
  it("empty / all-silence utterance → respond (nothing to judge)", () => {
    expect(grade([]).decision).toBe("respond");
    expect(grade([[0.05, 0.0], [0.05, 0.0]]).decision).toBe("respond");
  });
});
