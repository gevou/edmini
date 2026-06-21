# Handoff: Target-Speaker VAD (TS-VAD) feature for edmini

You're picking up a feature built in a prior session. Read this, then continue from "Remaining work."
Assumes you have the repo and `bd` working locally.

## What it is

A standalone, edmini-agnostic module that gates the mic MediaStream so only the ENROLLED (target)
speaker passes through — other people, a TV, background voices get muted before audio reaches OpenAI.
Goal: Ed responds only to its owner. Lives in `src/lib/tsvad/` (read its `README.md` first).

## Why it's front-end (load-bearing constraint)

edmini's audio goes browser → OpenAI peer-to-peer over WebRTC (`VoiceAgent.startSession`:
getUserMedia → pc.addTrack); the backend never sees audio. So gating MUST happen client-side at the
source. Gating before the track reaches OpenAI also keeps OpenAI's own VAD/turn-detection correct.

## Where it is

- Branch: `claude/intelligent-meitner-xfh3of`  ·  PR #5: https://github.com/gevou/edmini/pull/5
- Commits: `a8595d1` (core feature), `491a938` (guided enrollment), `255781b` (validation harness)
- Code: `src/lib/tsvad/` (core + UI), `src/app/tsvad-lab/` (standalone lab page), `scripts/` (validation)
- Deps added: `onnxruntime-web` (prod), `onnxruntime-node` (dev, for the harness)

## Key decisions already made (don't relitigate)

1. **MODEL:** 3D-Speaker CAM++ (`iic/speech_campplus_sv_zh-cn_16k-common`) — Apache-2.0 weights,
   in-house (non-VoxCeleb) training data, ~7M params, ONNX. Chosen because edmini may ship commercially
   and VoxCeleb is non-commercial. RULED OUT: WeSpeaker/SpeechBrain ECAPA (VoxCeleb). BACKUP: NeMo
   TitaNet-Large (CC-BY-4.0 weights, English-optimized) only if the "weights ≠ training data" theory is
   accepted. Full rationale is in PR #5's body and beads `edmini-xz9`.
2. **Enrollment UX:** single target, GUIDED CAPTURE v1 — one screen, ~10s natural speech, live meter,
   instant self-test. NOT a scripted wizard (d-vectors are text-independent). No adaptation, no
   multi-speaker yet (deferred).

## Architecture (pure core is tested; browser layer needs a device)

- **Pure, unit-tested:** `cosine.ts`, `gate.ts` (hysteresis + EMA + hang + asymmetric ramps),
  `enrollment.ts` (per-window-normalized centroid), `fbank.ts` (80-dim log-mel + CMN), `resample.ts`,
  `level.ts`
- **Browser:** `embedder-onnx.ts` (CAM++ via onnxruntime-web, lazy import), `worklet/gate-source.ts`
  (Blob AudioWorklet), `pipeline.ts` (orchestrator), `ui/VoiceEnrollment.tsx`, `enrollment-store.ts`
  (localStorage)
- **Tuning knobs:** `DEFAULT_GATE_CONFIG` in `types.ts` (openThreshold 0.45 / closeThreshold 0.30 are
  STARTING POINTS — set real values from the harness's EER threshold). Enrollment silence floor
  `minLevel` 0.015.
- **Pre-enrollment behavior:** pass-through (Ed responds to everyone until enrolled). Enrollment skips
  silence so it never pollutes the centroid.

## What's validated vs not

- **DONE (in-container, no network):** I/O contract verified against a live ONNX Runtime —
  `feats[1,T,80] → embs[1,192]`, matches `embedder-onnx.ts` defaults; full `fbank → ONNX → cosine` path
  runs and separates speakers. Guarded by `src/lib/tsvad/__tests__/embedder-contract.test.ts` using a
  committed synthetic stand-in model (`scripts/fixtures/synthetic_campplus.onnx`). Full suite 126
  passing, `tsc` clean, `next build` green.
- **NOT done:** real CAM++ accuracy + all on-device checks. The build env blocks HF/ModelScope, so the
  real ~28MB weights could not be fetched there.

## Remaining work (priority order)

1. **CREATE THE BEADS ISSUE:** `edmini-xz9` was filed in a throwaway container but could NOT sync (the
   CI git proxy 403s Dolt's push protocol). Recreate it in the canonical Dolt DB from the "For beads"
   section of PR #5's body (title, type=feature, P3, labels voice/research, related→`edmini-qo3`,
   licensing decision, acceptance criteria). Then `bd dolt push`.
2. **Validate the real model.** Get the real CAM++ ONNX, place at `public/models/campplus.onnx`, run:
   ```
   pnpm tsvad:validate ./public/models/campplus.onnx ./samples   # <speakerId>_<utt>.wav, 16k mono 16-bit
   ```
   Confirm enrolled-you scores clearly above a second ENGLISH speaker (CAM++ is Mandarin-centric — try
   the bilingual zh/en variant if weak). Set `openThreshold`/`closeThreshold` from the reported EER
   threshold.
3. **Wire into `VoiceAgent` behind a flag** — seam is documented in `src/lib/tsvad/README.md`: in
   `startSession`, between getUserMedia and pc.addTrack, create the VAD, start it, use
   `getProcessedStream()` (fall back to raw if not enrolled); add `VoiceEnrollment` to onboarding; call
   `vad.stop()` in `stopSession`. Exercise on `/tsvad-lab` first.
4. **On-device:** phone-browser latency through the AudioWorklet; onset clipping by ear; fbank fidelity
   vs Kaldi (`fbank.ts` is readable, not bit-exact — swap to a wasm Kaldi fbank only if scores look off).
5. **TRIVIAL FIX:** `CLAUDE.md` + `AGENTS.md` reference the stale beads module path
   `github.com/gastownhall/beads`; it moved to `github.com/steveyegge/beads` (old path 404s the go.mod
   module declaration, breaking `go install`). Also `bd sync` in AGENTS.md is now `bd dolt push/pull`.

## Deferred (future, not now)

Passive adaptation (track voice drift on high-confidence windows, with anchor + reset safeguards);
multi-speaker household (set of centroids, max-cosine match).
