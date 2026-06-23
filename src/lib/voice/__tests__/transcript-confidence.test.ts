import { describe, it, expect } from "vitest";
import {
  meanLogprob,
  normalizeTranscript,
  isLikelyNonSpeech,
  type TranscriptLogprob,
} from "../transcript-confidence";

const lp = (...xs: number[]): TranscriptLogprob[] => xs.map((logprob, i) => ({ token: `t${i}`, logprob }));

describe("meanLogprob", () => {
  it("averages the token logprobs", () => {
    expect(meanLogprob(lp(-0.2, -0.4, -0.6))).toBeCloseTo(-0.4, 6);
  });
  it("returns null when logprobs are absent or empty", () => {
    expect(meanLogprob(undefined)).toBeNull();
    expect(meanLogprob(null)).toBeNull();
    expect(meanLogprob([])).toBeNull();
  });
});

describe("normalizeTranscript", () => {
  it("trims, lowercases, and strips surrounding punctuation", () => {
    expect(normalizeTranscript("  Bye-bye. ")).toBe("bye-bye");
    expect(normalizeTranscript("Thanks for watching!")).toBe("thanks for watching");
    expect(normalizeTranscript('"You"')).toBe("you");
  });
  it("collapses internal whitespace", () => {
    expect(normalizeTranscript("thank   you")).toBe("thank you");
  });
});

describe("isLikelyNonSpeech", () => {
  it("drops an empty / whitespace transcript", () => {
    expect(isLikelyNonSpeech({ transcript: "" })).toBe(true);
    expect(isLikelyNonSpeech({ transcript: "   " })).toBe(true);
  });

  it("drops a known non-speech artifact regardless of confidence", () => {
    // 'thanks for watching' / 'bye-bye' are classic whisper hallucinations on non-speech audio.
    expect(isLikelyNonSpeech({ transcript: "Thanks for watching!", logprobs: lp(-0.1, -0.1) })).toBe(true);
    expect(isLikelyNonSpeech({ transcript: "Bye-bye.", logprobs: lp(-0.05) })).toBe(true);
  });

  it("drops an ambiguous stock phrase only when logprobs confirm low confidence", () => {
    // 'thank you' can be genuine — keep it when confidently transcribed...
    expect(isLikelyNonSpeech({ transcript: "Thank you.", logprobs: lp(-0.1, -0.2) })).toBe(false);
    // ...but drop it when the transcription is low-confidence (likely a hallucination on noise).
    expect(isLikelyNonSpeech({ transcript: "Thank you.", logprobs: lp(-1.2, -1.6) })).toBe(true);
  });

  it("does NOT drop an ambiguous phrase when logprobs are unavailable (benefit of the doubt)", () => {
    expect(isLikelyNonSpeech({ transcript: "okay" })).toBe(false);
  });

  it("keeps a genuine, confidently-transcribed command", () => {
    expect(
      isLikelyNonSpeech({ transcript: "Schedule a meeting tomorrow at noon", logprobs: lp(-0.2, -0.3, -0.1) }),
    ).toBe(false);
  });

  it("drops any transcript whose mean logprob is below the hard garbage floor", () => {
    // Non-stock text but the model was essentially guessing → garbage.
    expect(isLikelyNonSpeech({ transcript: "grbl wuh", logprobs: lp(-2.5, -3.0) })).toBe(true);
  });

  it("respects a custom policy", () => {
    expect(
      isLikelyNonSpeech({ transcript: "ping", logprobs: lp(-0.1) }, { alwaysDropPhrases: ["ping"] }),
    ).toBe(true);
  });
});
