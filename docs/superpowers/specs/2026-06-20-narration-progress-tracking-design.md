# Narration Progress Tracking — Design Spec

**Date:** 2026-06-20 · **Status:** approved-pending-review · **Bead:** `edmini-mb0`
**Precedes:** `edmini-69p` (partial-delivery recovery) · **Relates:** `edmini-xct` (voice-provider abstraction, backlog)

## Context

edmini narrates run results by voice (9ex). We want the UI to **show where the audio narration
currently is** — which part of Ed's message has been spoken vs not — and to lay the plumbing for
`edmini-69p` (on barge-in, re-speak the unspoken part).

Facts about how the voice provider behaves (OpenAI Realtime today; **see provider-flexibility below**):
- It sends the **entire transcript first** (a quick burst of deltas), **then** plays the audio through
  that now-fixed text over several seconds. So the target text is complete and static before playback.
- **No per-word timestamps**, and WebRTC auto-plays a continuous media stream — so the *only* accurately
  measurable signal is **elapsed audio-playback time** (`audioEl.currentTime`).

## Design

### The conservative cursor (core principle)

Model "spoken so far" as a **deliberate lower bound**, not an accurate position. Recovery (`69p`) will
re-speak *with overlap* and assume *less* was delivered — exactly how a person repeats themselves when
interrupted ("…so as I was saying, the export—"). Because of that, precision is unnecessary and we bias
toward "not yet spoken." A wrong estimate degrades gracefully: worst case Ed repeats a few extra words.

- **Measure** elapsed audio time (accurate): snapshot `audioEl.currentTime` when an utterance's audio
  starts; `elapsed = now − start`.
- **Map** elapsed → character index via a **speaking rate** (chars/sec), **self-calibrated** from finished
  utterances (true duration ÷ char count; seeded at a sane default ≈ 15 chars/sec).
- **Bias conservative:** round the index *down* to a word boundary and subtract a small margin → the cursor
  is always at or behind where the audio actually is.
- On response end, snap the cursor to the full length.

### Visual

In Ed's active bubble, the **spoken** portion (≤ cursor) renders at full opacity; the **not-yet-spoken**
tail is **dimmed**, and the boundary advances as Ed speaks. (Chosen over a progress underline because the
ask is to track *which words* have been spoken.)

### `69p` hook (future — not built here)

The module also exposes the **clause/sentence boundary at or before the cursor** — the natural resume
point. `69p` reads that on barge-in and re-speaks from there, accepting overlap. This feature builds the
conservative cursor + the accurate elapsed-time plumbing `69p` needs; it does not do the re-speak.

### Provider flexibility (stay decoupled from OpenAI Realtime)

The cursor is a **pure, provider-agnostic module** `src/lib/voice/narration-progress.ts`:
`advance({ fullText, elapsedAudioMs, rate }) → { spokenIndex, resumeBoundaryIndex }`, plus
`calibrate(durationMs, charCount)`. It knows nothing about OpenAI events. The adapter in `VoiceAgent.tsx`
maps provider events → these inputs (audio-start, elapsed time, response-end). Mirrors `ledger.ts`'s
pure-core / thin-binding split. See [edmini-v1-design.md §6](../architecture/edmini-v1-design.md) and the
backlog bead for the broader voice-session interface.

## Components

- **`src/lib/voice/narration-progress.ts`** (new, pure) + tests: monotonic cursor; conservative
  (never exceeds the rate-based estimate; word-boundary snap; margin); clamp to text length;
  `resumeBoundaryIndex` ≤ `spokenIndex` at a clause/sentence boundary; rate calibration.
- **`VoiceAgent.tsx`**: per-utterance `audioStartRef` (set on first audio of a response); a lightweight
  ticker (rAF or interval) while speaking that calls `advance(...)` and stores `spokenIndex` on the active
  turn; render the bright/dim split; calibrate on response end.

## Verification

- Unit tests for `narration-progress` (pure).
- Live: dispatch a run, watch Ed narrate — the dim/bright boundary should sweep through the text roughly
  in step with the audio, staying at-or-behind the voice. tsc/build/lint clean.

## Out of scope

- `69p` recovery (re-speak / `conversation.item.truncate`) — separate bead.
- The full voice-provider abstraction refactor (`edmini-7c4`, backlog) — this only keeps the seam clean.
- Sample-accurate karaoke (would require replacing WebRTC auto-play with manual Web Audio).
