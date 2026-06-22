# Speaker Identity — Roadmap, Decisions & Accuracy Paths

**Date:** 2026-06-21 · **Status:** decisions captured; sub-items have beads
**Relates:** `conversational-presence.md` (§4 listening stack — the framing) · grade-and-suppress spec
(`2026-06-21-grade-and-suppress-design.md`) · beads `edmini-5y7` (grade-and-suppress, shipped),
`edmini-7vr` (TS-VAD engine, shipped), `edmini-qo3` (input addressivity)

Captures the decisions and open paths from the 2026-06-21 grade-and-suppress validation session, so they
survive context loss. TS-VAD = target-speaker voice activity detection; the engine is `src/lib/tsvad`
(CAM++ ONNX d-vectors → cosine vs an enrolled centroid).

## Decisions locked

1. **Grade-and-suppress shipped** (`edmini-5y7`): TS-VAD grades each utterance in parallel; raw mic to
   OpenAI (zero added latency); at turn-end edmini responds or suppresses (`conversation.item.delete` +
   a `heard` event). Verified on device. The ~1 s speaker-ID confidence ramp that *kills* an inline gate
   is *free* when grading a completed utterance.
2. **Drop the grading toggle — it's a test artifact.** Grading is simply ON whenever the user is
   **enrolled** (not enrolled → pass-through, which the grader already does). The header on/off toggle
   goes away. → bead **`edmini-hy8`** (UX refinement).
3. **Enrollment UI is the real onboarding** — promote the voice-signature capture; not a debug affordance.
4. **Per-message grade display: responded turns only.** Show the confidence next to the timestamp on the
   user turns Ed answered. Suppressed turns stay hidden (logged to `heard`, no context pollution). →
   bead **`edmini-hy8`**.
5. **Multi-speaker: start single-target.** The roster (4–5 enrolled + auto-tag) is a separate, later
   capability. → bead **`edmini-q1e`**.

## Performance finding (multi-speaker) — runtime cost ≈ zero

The bottleneck is the **embedding** (CAM++ ONNX per window, ~48 ms Node / slower in-browser WASM), and it
is **independent of the number of enrolled speakers**: embed the window once, then compare the 192-dim
vector to each centroid. A cosine is ~192 multiply-adds (sub-µs). So N=5 vs N=1 = same embed + 4 trivial
dot products. **No added latency, no meaningful CPU, trivial memory (N×192 floats).** Grading the
*completed* utterance means embed latency never sits on the critical path. **The cost of multi-speaker is
accuracy and enrollment UX, not performance.**

## Accuracy — the model is the lever

Discrimination quality is fundamentally the model's. Today: CAM++ `zh-cn` (Mandarin-centric) gives
compressed English margins (live self-score 0.4–0.6+ vs 0.65 on Chinese). Fine for 1-vs-rest; tighter for
N-way. Paths forward, all **commercially-safe (no VoxCeleb)** unless noted: → bead **`edmini-ce9`**.

1. **CAM++ `zh_en` bilingual** — already downloaded (`public/models/campplus_zh_en.onnx`, gitignored,
   from sherpa-onnx HF `csukuangfj/speaker-embedding-models`). Same arch, English in training → should
   widen English margins. Cheapest try (swap the model URL).
2. **ERES2Net** — a *stronger architecture* than CAM++ (more params, better separation), same 3D-Speaker
   / Apache-2.0 / non-VoxCeleb provenance, in the same sherpa-onnx zoo
   (`3dspeaker_speech_eres2net_*`, incl. a 200k-speaker variant). Slower per embed, but fine (we grade
   completed utterances). The real N-way accuracy lever.
3. **Margin logic (free):** for the roster, require a **top1 − top2 gap**, not just an absolute
   threshold — keeps an unenrolled 6th person from spuriously matching someone. Uncertain → "unknown",
   never guess.
4. **Managed escalation:** a **parallel Speechmatics stream** — realtime *enrolled* speaker ID, likely
   better-tuned than self-hosted, at the cost of a paid API + timestamp-alignment plumbing. Fallback if
   self-hosted models plateau. (From the 2026-06-20 diarization research, on `edmini-qo3`.)
5. **Avoid:** VoxCeleb-trained models (WeSpeaker / SpeechBrain ECAPA) — non-commercial license. NeMo
   TitaNet (English-optimized, CC-BY-4.0 *weights* but VoxCeleb-*trained*) is a backup only if the
   "weights ≠ training data" theory is accepted.
6. **Structural lever (later, multi-input):** channel-as-role prior (AirPods=principal, room mic=others)
   — conversational-presence §4. Reduces reliance on the model.

**Quantify, don't guess — the bake-off:** the offline harness (`pnpm tsvad:validate <onnx> <wavDir>`)
reports EER + same/diff-speaker margin. The repo's example WAVs are *Chinese*, so they don't test
English. Plan: record ~3 short clips each of 2 **English** speakers (16 kHz mono, `speakerId_utt.wav`),
then run CAM++ zh-cn vs CAM++ zh_en vs ERES2Net and pick by the numbers. → bead **`edmini-ce9`**.

## Enroll other speakers from audio edmini already hears

Principal authorizes who's retained (the consent gesture, per conversational-presence §8). Two flavors,
very different in difficulty: → bead **`edmini-6kl`**.

- **Proactive — "Bob, say something to authorize you" (do first, easy).** The *existing* enrollment flow,
  voice-triggered and pointed at the next speaker: principal calls a tool → edmini says "go ahead, Bob" →
  captures Bob's next ~10 s → builds his centroid. **No new infrastructure** (forward capture, full clean
  10 s, good centroid). Authority gate is natural: only the enrolled principal may call
  `enroll_speaker(name)`.
- **Retroactive — "that was Bob, add him" (later, elegant).** Enroll from *past* audio → requires the
  conversational-presence **rolling raw-audio buffer** (tier 1, §5 — not built; today we keep only `heard`
  text, not the waveform), plus: picking *which* recent unknown utterance was Bob (heuristic: most-recent
  suppressed speaker), and likely **incremental enrollment** (short clips → accumulate over utterances;
  the "passive adaptation" `7vr` deferred). Rides on infrastructure we'd build for decide-later anyway.

Both expose an `enroll_speaker(name)` tool to the voice model, gated to the principal.

## Prod model hosting — DECIDED: Vercel Blob (2026-06-21)

The CAM++ ONNX (~28 MB) is gitignored, so prod (phone) grading **fails open** until it's hosted. The
laptop dev test works with the local file. **Decision: host the *chosen* model on Vercel Blob** and
point the embedder `modelUrl` at the Blob URL — NOT committed to git (avoids 28 MB binaries in history,
and we're swapping model variants in `edmini-ce9`). **Sequence: run `ce9` (bake-off) → upload the winner
to Vercel Blob → set `modelUrl`.** Not urgent (laptop test works now). → bead **`edmini-5on`**.

## Bead map

| Bead | Scope | Depends on |
|---|---|---|
| `edmini-hy8` | UX refinement: enrollment-gated grading (drop toggle); per-message grade on responded turns | 5y7 |
| `edmini-ce9` | TS-VAD accuracy: English bake-off (CAM++ zh_en, ERES2Net) + top1−top2 margin logic | 7vr |
| `edmini-6kl` | `enroll_speaker` tool — proactive (now); retroactive needs the rolling buffer | 7vr, ce9 |
| `edmini-q1e` | Multi-speaker roster + auto-tag (N centroids, argmax+margin, per-speaker `from`) | ce9, 6kl |
| `edmini-5on` | Host the chosen model on Vercel Blob; set `modelUrl` (after the bake-off) | ce9 |
