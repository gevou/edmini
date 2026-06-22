import { describe, it, expect } from "vitest";
import {
  createSpeakerClassifier,
  DEFAULT_CLASSIFIER_POLICY,
  type CandidateScore,
} from "../speaker-classifier";

/**
 * Feed a sequence of voiced windows. Each window is a map of speakerId → cosine for that window.
 * `level` defaults above the voiced floor so windows count unless explicitly silenced.
 */
function classify(
  windows: Array<{ scores: CandidateScore[]; level?: number }>,
  policy?: Parameters<typeof createSpeakerClassifier>[0],
) {
  const c = createSpeakerClassifier(policy);
  c.begin();
  for (const w of windows) c.addWindow(w.scores, w.level ?? 0.2);
  return c.end();
}

const w = (scores: Record<string, number>, level = 0.2) => ({
  scores: Object.entries(scores).map(([id, cosine]) => ({ id, cosine })),
  level,
});

describe("speaker-classifier (top1-top2 margin)", () => {
  describe("single-centroid back-compat (one candidate)", () => {
    it("accepts a clear single-target match (top1 well above absThreshold)", () => {
      const r = classify([w({ George: 0.5 }), w({ George: 0.55 }), w({ George: 0.6 }), w({ George: 0.5 })]);
      expect(r.label).toBe("George");
      expect(r.top1).toBeGreaterThan(DEFAULT_CLASSIFIER_POLICY.absThreshold);
      expect(r.top2Id).toBeNull(); // no runner-up; floor stands in
    });

    it("rejects a single-target below absThreshold → unknown (a different speaker)", () => {
      const r = classify([w({ George: 0.05 }), w({ George: -0.02 }), w({ George: 0.1 }), w({ George: 0.0 })]);
      expect(r.label).toBe("unknown");
    });

    it("single-target margin reduces to the absolute threshold (top2 = unknown floor)", () => {
      // With one candidate, accept iff top1 >= absThreshold, since margin is measured against the floor.
      const justAbove = DEFAULT_CLASSIFIER_POLICY.absThreshold + 0.05;
      const r = classify([w({ Roger: justAbove }), w({ Roger: justAbove }), w({ Roger: justAbove }), w({ Roger: justAbove })]);
      expect(r.label).toBe("Roger");
    });
  });

  describe("N-centroid roster", () => {
    it("identifies a clear winner when top1 beats top2 by the margin", () => {
      const r = classify([
        w({ George: 0.6, Roger: 0.2 }),
        w({ George: 0.62, Roger: 0.18 }),
        w({ George: 0.58, Roger: 0.22 }),
        w({ George: 0.6, Roger: 0.2 }),
      ]);
      expect(r.label).toBe("George");
      expect(r.margin).toBeGreaterThanOrEqual(DEFAULT_CLASSIFIER_POLICY.marginThreshold);
      expect(r.top2Id).toBe("Roger");
    });

    it("returns unknown when top1 and top2 are too close (ambiguous), even if both clear absThreshold", () => {
      const r = classify([
        w({ George: 0.62, Roger: 0.6 }),
        w({ George: 0.6, Roger: 0.61 }),
        w({ George: 0.61, Roger: 0.59 }),
        w({ George: 0.6, Roger: 0.6 }),
      ]);
      expect(r.label).toBe("unknown");
      // top1 cleared the absolute bar, but the margin to the runner-up did not.
      expect(r.top1).toBeGreaterThan(DEFAULT_CLASSIFIER_POLICY.absThreshold);
      expect(r.margin).toBeLessThan(DEFAULT_CLASSIFIER_POLICY.marginThreshold);
    });

    it("unenrolled 6th person → unknown (no centroid clears the absolute threshold)", () => {
      const r = classify([
        w({ George: 0.15, Roger: 0.12 }),
        w({ George: 0.1, Roger: 0.18 }),
        w({ George: 0.2, Roger: 0.1 }),
        w({ George: 0.12, Roger: 0.14 }),
      ]);
      expect(r.label).toBe("unknown");
    });
  });

  describe("evidence floor and silence", () => {
    it("ignores silence windows (below the voiced floor) in the per-candidate means", () => {
      const r = classify([
        w({ George: 0.6, Roger: 0.2 }),
        w({ George: 0.6, Roger: 0.2 }),
        w({ George: 0.6, Roger: 0.2 }),
        w({ George: 0.6, Roger: 0.2 }),
        w({ George: -0.9, Roger: 0.9 }, 0.001), // silent: must not flip the winner
        w({ George: -0.9, Roger: 0.9 }, 0.001),
      ]);
      expect(r.label).toBe("George");
      expect(r.voicedWindows).toBe(4);
    });

    it("too few voiced windows → unknown (insufficient evidence, never guess)", () => {
      const r = classify([w({ George: 0.9, Roger: 0.1 }), w({ George: 0.9, Roger: 0.1 })]);
      expect(r.label).toBe("unknown");
      expect(r.voicedWindows).toBe(2);
    });

    it("no candidates / empty utterance → unknown", () => {
      expect(classify([]).label).toBe("unknown");
      expect(classify([w({}), w({})]).label).toBe("unknown");
    });
  });
});
