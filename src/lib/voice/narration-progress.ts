/**
 * Narration progress (edmini-mb0) — a CONSERVATIVE estimate of how far the voice has played through
 * Ed's (already-complete) transcript. Pure and provider-agnostic: given elapsed audio-playback time and
 * the full text, it returns a spoken-position cursor that is a deliberate LOWER BOUND (rounded down to a
 * word boundary, biased behind by a time margin), plus the clause/sentence boundary at or before it
 * (the resume point edmini-69p re-speaks from). No per-word timestamps exist, so this is intentionally
 * fuzzy-toward-"not yet spoken". See docs/superpowers/specs/2026-06-20-narration-progress-tracking-design.md.
 */

const DEFAULT_SEED_RATE = 14; // chars/sec — typical TTS pace; calibrate() can sharpen it
const DEFAULT_MARGIN_MS = 200; // playback uncertainty → bias the cursor behind

export interface SpokenPosition {
  /** Conservative spoken-so-far index into fullText (always a word boundary). */
  spokenIndex: number;
  /** Clause/sentence boundary at or before spokenIndex — the resume point for recovery (edmini-69p). */
  resumeBoundaryIndex: number;
}

export interface NarrationProgress {
  advance(input: { fullText: string; elapsedAudioMs: number }): SpokenPosition;
  /** Feed a finished utterance (its audio duration + char count) to sharpen the rate. */
  calibrate(durationMs: number, charCount: number): void;
  readonly rateCharsPerSec: number;
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "\r";
}

/** Largest j <= idx where the slice text[0..j] ends on a word boundary (text[j] is whitespace, or j is
 *  0 / text.length). Excludes a partially-spoken final word → conservative. */
export function snapDownToWordBoundary(text: string, idx: number): number {
  if (idx >= text.length) return text.length;
  if (idx <= 0) return 0;
  let j = idx;
  while (j > 0 && !isSpace(text[j])) j--;
  return j;
}

const BOUNDARY = /[.!?,;:—]/;

/** Position just after the last clause/sentence punctuation at or before idx; 0 if none. */
export function lastClauseBoundary(text: string, idx: number): number {
  for (let k = Math.min(idx, text.length); k > 0; k--) {
    if (BOUNDARY.test(text[k - 1])) return k;
  }
  return 0;
}

export function createNarrationProgress(
  opts: { seedRate?: number; marginMs?: number } = {},
): NarrationProgress {
  const marginMs = opts.marginMs ?? DEFAULT_MARGIN_MS;
  // Seed the running average with one synthetic 2-second sample so early estimates are sane.
  let sumChars = (opts.seedRate ?? DEFAULT_SEED_RATE) * 2;
  let sumSec = 2;

  return {
    get rateCharsPerSec() {
      return sumChars / sumSec;
    },
    advance({ fullText, elapsedAudioMs }) {
      const effectiveSec = Math.max(0, elapsedAudioMs - marginMs) / 1000;
      const raw = Math.floor(effectiveSec * (sumChars / sumSec));
      const clamped = Math.max(0, Math.min(raw, fullText.length));
      const spokenIndex = snapDownToWordBoundary(fullText, clamped);
      return { spokenIndex, resumeBoundaryIndex: lastClauseBoundary(fullText, spokenIndex) };
    },
    calibrate(durationMs, charCount) {
      if (durationMs <= 0 || charCount <= 0) return;
      sumChars += charCount;
      sumSec += durationMs / 1000;
    },
  };
}
