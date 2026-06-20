import { describe, it, expect } from "vitest";
import {
  createNarrationProgress,
  snapDownToWordBoundary,
  lastClauseBoundary,
} from "../narration-progress";

describe("snapDownToWordBoundary", () => {
  const t = "hello world foo";
  it("keeps an index that already sits on a boundary (next char is space)", () => {
    expect(snapDownToWordBoundary(t, 5)).toBe(5); // "hello"
  });
  it("retreats out of a partially-spoken word", () => {
    expect(snapDownToWordBoundary(t, 9)).toBe(5); // mid "world" → back to "hello"
  });
  it("clamps past end and floors at 0", () => {
    expect(snapDownToWordBoundary(t, 999)).toBe(t.length);
    expect(snapDownToWordBoundary(t, 0)).toBe(0);
  });
});

describe("lastClauseBoundary", () => {
  it("returns the position just after the last clause/sentence punctuation", () => {
    const t = "Done. Now the export, finally";
    expect(lastClauseBoundary(t, t.length)).toBe("Done. Now the export,".length);
    expect(lastClauseBoundary("Done. Now", 9)).toBe(5); // after "Done."
  });
  it("returns 0 when there is no boundary", () => {
    expect(lastClauseBoundary("no punctuation here", 19)).toBe(0);
  });
});

describe("createNarrationProgress.advance", () => {
  it("is a conservative lower bound: tiny elapsed → 0 (margin + word snap)", () => {
    const p = createNarrationProgress(); // seed 14 c/s, margin 200ms
    expect(p.advance({ fullText: "twenty times twenty is four hundred", elapsedAudioMs: 100 }).spokenIndex).toBe(0);
  });
  it("advances monotonically and lands on word boundaries", () => {
    const p = createNarrationProgress();
    const text = "twenty times twenty is four hundred";
    let last = 0;
    for (const ms of [0, 500, 1000, 1500, 2000, 3000]) {
      const { spokenIndex } = p.advance({ fullText: text, elapsedAudioMs: ms });
      expect(spokenIndex).toBeGreaterThanOrEqual(last); // monotonic
      // word boundary: start, end, or a position whose char is whitespace
      expect(spokenIndex === 0 || spokenIndex === text.length || text[spokenIndex] === " ").toBe(true);
      last = spokenIndex;
    }
  });
  it("clamps at the text length", () => {
    const p = createNarrationProgress();
    const text = "short";
    expect(p.advance({ fullText: text, elapsedAudioMs: 999999 }).spokenIndex).toBe(text.length);
  });
  it("exposes resumeBoundaryIndex at/before spokenIndex", () => {
    const p = createNarrationProgress({ seedRate: 1000, marginMs: 0 }); // fast → fully spoken
    const text = "First clause, second clause is here";
    const { spokenIndex, resumeBoundaryIndex } = p.advance({ fullText: text, elapsedAudioMs: 1000 });
    expect(resumeBoundaryIndex).toBeLessThanOrEqual(spokenIndex);
    expect(resumeBoundaryIndex).toBe("First clause,".length);
  });
});

describe("createNarrationProgress.calibrate", () => {
  it("raises the rate when fed faster real samples", () => {
    const p = createNarrationProgress({ seedRate: 14 });
    const before = p.rateCharsPerSec;
    p.calibrate(1000, 40); // 40 chars in 1s
    expect(p.rateCharsPerSec).toBeGreaterThan(before);
  });
  it("ignores degenerate samples", () => {
    const p = createNarrationProgress();
    const before = p.rateCharsPerSec;
    p.calibrate(0, 10);
    p.calibrate(1000, 0);
    expect(p.rateCharsPerSec).toBe(before);
  });
});
