# TS-VAD Speaker-Embedding Bake-Off — Results

**Date:** 2026-06-21 · **Bead:** `edmini-ce9` · **Feeds:** `edmini-5on` (which model to host), `edmini-q1e` (N-speaker roster)
**Parent:** [`speaker-identity-roadmap.md`](./speaker-identity-roadmap.md) §"Accuracy — the model is the lever"

## The question

CAM++ `zh-cn` (Mandarin-centric) gives **compressed English margins** — fine for 1-vs-rest, tight for
N-way. Does **CAM++ `zh_en`** (bilingual, same architecture) or **ERES2Net** (stronger architecture)
widen English speaker separation? Quantify, don't guess.

## Method

Offline harness `pnpm tsvad:validate <onnx> samples` — reuses the REAL fbank + cosine pipeline through
onnxruntime-node (validates the actual code, not a reimplementation). Reports each model's true I/O
contract, same- vs diff-speaker mean cosine, separation margin, a crude EER + suggested threshold, and
embed latency.

**Sample set:** 2 English speakers (George, Roger) × 3 clips each, recorded by the user, converted to
16 kHz mono 16-bit PCM WAV (`<speaker>_<n>.wav`). Clip durations: George 3.4 / 3.9 / 9.0 s, Roger
3.9 / 3.9 / 9.7 s — all comfortably > 1 s (no tiny clips; the earlier "George_1 is tiny" worry didn't
materialize). That yields 6 same-speaker pairs (3 within George + 3 within Roger) and 9 diff-speaker
pairs.

**Models** (all commercially-safe, NON-VoxCeleb, from sherpa-onnx HF `csukuangfj/speaker-embedding-models`):

- CAM++ zh-cn — `public/models/campplus.onnx` (the current production model)
- CAM++ zh_en — `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`
- ERES2Net — `3dspeaker_speech_eres2net_sv_zh-cn_16k-common.onnx`
- ERES2NetV2 — `3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx` (added: the strongest non-VoxCeleb
  ERES2Net "common" variant, to give the "stronger architecture" hypothesis its best shot)

All four share the **same I/O contract**: input `x`, output `embedding`, embedding dim **192**, TF feature
layout, 80-mel fbank — so the existing pipeline runs them unchanged. No IO mismatch to resolve; every run
is a real result.

## Results

| Model | emb dim | I/O (in→out) | same-spk cos | diff-spk cos | **margin (same−diff)** | ~EER | sugg. thr | embed latency |
|---|---|---|---|---|---|---|---|---|
| CAM++ zh-cn (baseline) | 192 | x → embedding | 0.858 | 0.634 | **0.224** | 0.0% | 0.70 | 55 ms |
| **CAM++ zh_en** ⭐ | 192 | x → embedding | 0.832 | **0.294** | **0.538** | 0.0% | 0.37 | **54 ms** |
| ERES2Net (zh-cn common) | 192 | x → embedding | 0.888 | 0.682 | 0.205 | 0.0% | 0.74 | 646 ms |
| ERES2NetV2 (zh-cn common) | 192 | x → embedding | 0.883 | 0.637 | 0.246 | 0.0% | 0.67 | 209 ms |

(EER is 0% for every model on this tiny set — the separation is clean enough that some threshold splits
all 6 same pairs from all 9 diff pairs. EER is therefore **not** discriminating here; the **margin** is.)

## Winner: CAM++ zh_en bilingual

**CAM++ `zh_en` more than doubles the English separation margin (0.538 vs 0.224)** — and it does so
exactly the way we hoped: by collapsing the **diff-speaker** cosine from 0.634 → **0.294** (it pushes
*different* English speakers apart), while keeping same-speaker cosine high (0.832). Result confirmed
deterministic across repeat runs (margin 0.538 both times). And it's **free on latency** — 54 ms,
identical to the baseline (same architecture, same param count).

The hypothesis is settled: for English, **bilingual training data is the lever, not a bigger
architecture.** The stronger ERES2Net architectures did **not** help — ERES2Net's margin (0.205) is
actually *worse* than the baseline, and ERES2NetV2 (0.246) barely beats it, both at 4–12× the latency.
That makes sense: those are `zh-cn`-only models; architecture can't compensate for the absence of English
in the training distribution. (A hypothetical ERES2Net `zh_en` might win, but none exists in the zoo; the
only English ERES2Net variants are VoxCeleb-trained — excluded by license.)

**Recommendation for `edmini-5on`: host CAM++ `zh_en`** (`campplus_zh_en.onnx`, 28 MB — same size class
as the current model, so no hosting/cost change). Drop-in swap: same dim, same I/O names, same fbank;
just point the embedder `modelUrl` at the new file. Suggested gate/grader threshold from this set ≈
0.37, but re-tune on device (see caveat).

### Caveats

- **Tiny sample set: 2 speakers, 3 clips each.** This is **directional, not definitive.** The margins
  and the 0.37 threshold are indicative; confirm on device with more speakers before locking thresholds.
- All ERES2Net candidates were `zh-cn`-only (no commercially-safe English/bilingual ERES2Net exists), so
  this bake-off cannot say whether the *architecture* would help English given English data — only that,
  with the models we can legally ship, **CAM++ zh_en wins decisively.**
- The fbank is a from-scratch implementation (see `fbank.ts` fidelity caveat). Identical for all four
  models, so it doesn't bias the comparison, but absolute cosine values may shift slightly vs a bit-exact
  Kaldi fbank.

## Margin logic (top1−top2) — shipped in `edmini-ce9`

The roadmap §"Accuracy" item 3: for an N-speaker roster, an absolute threshold alone lets an UNENROLLED
6th person spuriously match whichever enrolled centroid sits highest. Fix: require a **top1 − top2 gap**.

New pure module **`src/lib/tsvad/speaker-classifier.ts`** (exported from `index.ts`). Grades the
*completed* utterance (per-candidate mean cosine over voiced windows), then accepts a positive ID iff
**both**:

1. `top1 ≥ absThreshold` (default 0.35) — the best centroid is a genuine match, not just least-bad, AND
2. `top1 − top2 ≥ marginThreshold` (default **0.10**) — it clearly beats the runner-up.

Otherwise → **`"unknown"`** (uncertain never guesses). The 0.10 default is conservative against the
winning model's numbers (diff-speaker mean ≈ 0.29, same-speaker ≈ 0.83): a real winner clears 0.10 easily
while genuine near-ties are refused.

**Single-centroid back-compat:** with one candidate there's no runner-up, so `top2` falls back to an
`unknownFloor` (default 0); the margin check reduces to a second absolute bar and single-target behavior
is governed by `absThreshold` exactly as before. The existing single-target `utterance-grader.ts` is
unchanged; the new classifier is the N-way generalization that `edmini-q1e` (roster + auto-tag) will
adopt.

**Tests:** `src/lib/tsvad/__tests__/speaker-classifier.test.ts` (9 cases) — single-centroid accept/reject
unchanged; N-centroid clear-winner accept; N-centroid ambiguous (small top1−top2) → unknown;
unenrolled-person → unknown; silence excluded from means; too-few-voiced → unknown. Full suite: 158
passed; `tsc --noEmit` clean; `next build` green.

## Reproduce

```bash
# models live in public/models/ (gitignored; not committed — hosting is edmini-5on)
pnpm tsvad:validate /abs/path/to/public/models/campplus.onnx samples         # zh-cn baseline
pnpm tsvad:validate public/models/campplus_zh_en.onnx samples                # winner
pnpm tsvad:validate public/models/eres2net_zh_cn.onnx samples
pnpm tsvad:validate public/models/eres2netv2_zh_cn.onnx samples
```
