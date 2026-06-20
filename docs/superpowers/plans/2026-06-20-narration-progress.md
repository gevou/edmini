# Narration Progress (mb0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show where the audio narration currently is — dim the not-yet-spoken tail of Ed's bubble, advancing as he speaks — via a conservative, provider-agnostic spoken-position cursor.

**Architecture:** A pure module `src/lib/voice/narration-progress.ts` maps elapsed audio-playback time + the (already-complete) transcript to a CONSERVATIVE spoken index (lower bound: word-boundary snap, time margin) and the clause boundary at/before it (resume point for `edmini-69p`). `VoiceAgent.tsx` snapshots `audioEl.currentTime` at each utterance's audio start, runs a light ticker while Ed speaks to update a per-turn `spokenIndex`, and renders the bright/dim split. Mirrors the `ledger.ts` pure-core / thin-binding pattern. Spec: `docs/superpowers/specs/2026-06-20-narration-progress-tracking-design.md`.

**Tech Stack:** TypeScript, React 19, vitest, OpenAI Realtime (WebRTC audio via an `<audio>` element).

---

### Task 1: Pure module `narration-progress.ts`

**Files:**
- Create: `src/lib/voice/narration-progress.ts`
- Test: `src/lib/voice/__tests__/narration-progress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
      expect(spokenIndex === text.length || text[spokenIndex] === " ").toBe(true); // word boundary
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run src/lib/voice/__tests__/narration-progress.test.ts`
Expected: FAIL — `Cannot find module '../narration-progress'`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run src/lib/voice/__tests__/narration-progress.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/narration-progress.ts src/lib/voice/__tests__/narration-progress.test.ts
git commit -m "feat(mb0): conservative narration-progress module + tests"
```

---

### Task 2: Wire progress tracking into `VoiceAgent.tsx`

**Files:**
- Modify: `src/components/VoiceAgent.tsx`

> Note on calibration: `calibrate()` is intentionally NOT wired at runtime in v1. The only "utterance
> ended" signal we have (`response.done`) fires when audio *generation* finishes, before playback
> drains, so calibrating from it would over-estimate the rate (non-conservative). v1 uses the seeded
> rate + margin + word-snap; `calibrate()` stays unit-tested and ready for a future reliable audio-end
> signal.

- [ ] **Step 1: Import the module and extend the Turn type**

Add to the imports near the other `@/lib/voice` imports:

```tsx
import { createNarrationProgress, type NarrationProgress } from "@/lib/voice/narration-progress";
```

In `interface Turn { ... }`, add a field:

```tsx
interface Turn {
  id: number;
  userText: string | null;
  edText: string;
  edStreaming: boolean;
  spokenIndex?: number; // conservative spoken-so-far cursor while Ed narrates this turn (mb0)
}
```

- [ ] **Step 2: Add refs (progress instance, audio-start snapshot, ticker handle)**

Right after the existing `const edInitiatedPendingRef = useRef<boolean>(false);` line, add:

```tsx
  // Narration progress (mb0): a conservative spoken-position cursor for the active Ed turn.
  const narrationProgressRef = useRef<NarrationProgress | null>(null);
  if (!narrationProgressRef.current) narrationProgressRef.current = createNarrationProgress();
  const audioStartRef = useRef<number | null>(null); // audioEl.currentTime at this utterance's audio start
  const progressTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

- [ ] **Step 3: Add a stopProgressTicker helper (above startSession)**

Add this `useCallback` near the other small callbacks (e.g. just before `handleDataChannelMessage`):

```tsx
  const stopProgressTicker = useCallback(() => {
    if (progressTickerRef.current) {
      clearInterval(progressTickerRef.current);
      progressTickerRef.current = null;
    }
  }, []);
```

- [ ] **Step 4: Start the ticker when Ed's audio begins**

In `handleDataChannelMessage`, the `response.output_audio.delta` branch currently flips
`modelSpeakingFlagRef`. Replace that branch with:

```tsx
    if (type === "response.output_audio.delta") {
      setStatus("speaking");
      if (!modelSpeakingFlagRef.current) {
        modelSpeakingFlagRef.current = true;
        pushEvent({ kind: "model_speaking", label: "Model started speaking" });
        // mb0: snapshot the audio clock and start advancing the spoken cursor for the active turn.
        audioStartRef.current = audioElRef.current?.currentTime ?? null;
        stopProgressTicker();
        progressTickerRef.current = setInterval(() => {
          const audioEl = audioElRef.current;
          const start = audioStartRef.current;
          const activeId = currentTurnIdRef.current;
          if (!audioEl || start === null || activeId === null) return;
          const elapsedAudioMs = Math.max(0, (audioEl.currentTime - start) * 1000);
          setTurns((prev) =>
            prev.map((t) =>
              t.id === activeId
                ? {
                    ...t,
                    spokenIndex: narrationProgressRef.current!.advance({
                      fullText: t.edText,
                      elapsedAudioMs,
                    }).spokenIndex,
                  }
                : t,
            ),
          );
        }, 100);
      }
    }
```

- [ ] **Step 5: Stop the ticker + snap to full when the response ends**

In the same handler, the `response.done` branch currently calls `onResponseEnded()`. Replace it with:

```tsx
    if (type === "response.done") {
      setStatus("listening");
      modelSpeakingFlagRef.current = false;
      // mb0: stop advancing and mark the active turn fully spoken.
      stopProgressTicker();
      audioStartRef.current = null;
      const doneId = currentTurnIdRef.current;
      if (doneId !== null) {
        setTurns((prev) =>
          prev.map((t) => (t.id === doneId ? { ...t, spokenIndex: t.edText.length } : t)),
        );
      }
      onResponseEnded(); // clear in-flight, fire next queued response / drain narration
    }
```

- [ ] **Step 6: Add `stopProgressTicker` to the data-channel handler deps**

Find the dependency array at the end of `handleDataChannelMessage` (currently
`}, [postTurnToThread, dispatchToolCall, tryDrain, onResponseEnded, logVoiceOutput]);`) and add
`stopProgressTicker`:

```tsx
  }, [postTurnToThread, dispatchToolCall, tryDrain, onResponseEnded, logVoiceOutput, stopProgressTicker]);
```

- [ ] **Step 7: Reset progress in stopSession**

In `stopSession`, where the other voice refs are reset (after the `pendingToolResponsesRef.current = [];`
line), add:

```tsx
    stopProgressTicker();
    audioStartRef.current = null;
    narrationProgressRef.current = createNarrationProgress();
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 9: Commit**

```bash
git add src/components/VoiceAgent.tsx
git commit -m "feat(mb0): track audio-playback progress on the active Ed turn"
```

---

### Task 3: Render the spoken / not-yet-spoken split

**Files:**
- Modify: `src/components/VoiceAgent.tsx`

- [ ] **Step 1: Split Ed's bubble text by spokenIndex**

Find the Ed bubble render (the block containing `{turn.edText}` and the streaming pulse cursor). Replace
the `{turn.edText}` expression with a spoken/dim split:

```tsx
                    {turn.spokenIndex !== undefined && turn.spokenIndex < turn.edText.length ? (
                      <>
                        <span>{turn.edText.slice(0, turn.spokenIndex)}</span>
                        <span className="text-white/35">{turn.edText.slice(turn.spokenIndex)}</span>
                      </>
                    ) : (
                      turn.edText
                    )}
```

(Leave the trailing `{turn.edStreaming && (<span ... pulse />)}` cursor exactly as-is, immediately after.)

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && corepack pnpm build`
Expected: tsc clean; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/VoiceAgent.tsx
git commit -m "feat(mb0): dim the not-yet-spoken tail of Ed's bubble"
```

---

### Task 4: Verify (full suite + live)

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `corepack pnpm test`
Expected: all tests pass (existing 76 + the new narration-progress cases).

- [ ] **Step 2: Build**

Run: `corepack pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Live check**

Run `pnpm dev` (or use the deployed prod). Start a voice session, dispatch a run, and watch Ed narrate a
result. Confirm: the bright/dim boundary sweeps left-to-right through Ed's bubble roughly in step with
the audio, **staying at or behind** the voice (it should never claim a word is spoken before you hear
it), and snaps to fully-bright when the utterance ends. Short acks ("On it") sweep quickly — fine.

- [ ] **Step 4: Commit any doc/status updates** (if applicable)

```bash
git add -A && git commit -m "chore(mb0): verification notes"
```

---

## Notes for the implementer

- **Why conservative:** the cursor is a deliberate lower bound (word-snap + 200ms margin). It feeds
  `edmini-69p`, which re-speaks the remainder *with overlap* assuming less was delivered — so a slightly
  laggy cursor is correct, not a bug.
- **Provider seam:** `narration-progress.ts` knows nothing about OpenAI. All OpenAI-specific wiring
  (which event marks audio start/end, reading `audioEl.currentTime`) lives in `VoiceAgent.tsx`. Keep it
  that way (see `edmini-xct`).
- **Don't** rewrite the audio pipeline or add per-word timestamps — out of scope (would need Web Audio).
