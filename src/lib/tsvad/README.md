# Target-Speaker VAD (`tsvad`)

A standalone, **edmini-agnostic** feature (edmini-xz9): gate a microphone `MediaStream` so only the
**enrolled (target) speaker** passes through — other people, a TV, background voices get muted before
the audio reaches anything downstream.

Built independently first; wires into edmini's voice loop via one seam (below).

## Why it lives in the browser

edmini's audio goes **browser → OpenAI peer-to-peer over WebRTC**; the backend only mints ephemeral
keys and never sees audio. So speaker gating has to happen client-side, at the source — there is no
server-side audio stream to process. Gating before the track reaches OpenAI also keeps OpenAI's own
VAD/turn-detection correct for free (it only ever hears the target).

## Layering

```
MediaStreamSource(mic) → AudioWorkletNode('tsvad-gate') → MediaStreamDestination → gated track
                              │ taps hop-sized frames        ▲ applies gain
                              ▼                               │
        main thread: sliding window → resample 16k → CAM++ embed → cosine vs centroid → gate → gain
```

| Module | Role | Tested |
|---|---|---|
| `cosine.ts` | L2-normalize + cosine score | ✅ unit |
| `gate.ts` | hysteresis + EMA smoothing + hang + asymmetric ramps → gain | ✅ unit |
| `enrollment.ts` | average windows → centroid d-vector | ✅ unit |
| `fbank.ts` | 80-dim log-mel features (CAM++ input) + CMN | ✅ sanity |
| `resample.ts` | context-rate → 16 kHz | ✅ unit |
| `embedder-onnx.ts` | CAM++ via onnxruntime-web (lazy import) | device |
| `worklet/gate-source.ts` | AudioWorklet (tap + per-sample gain ramp) | device |
| `pipeline.ts` | orchestrates the graph + scoring loop | device |
| `enrollment-store.ts` | localStorage persistence | — |

The pure core (cosine/gate/enrollment/fbank/resample) is the load-bearing tunable logic and is fully
unit-tested. The browser layer (ONNX/worklet/pipeline) needs on-device validation.

## Model & licensing

**3D-Speaker CAM++** (`iic/speech_campplus_sv_zh-cn_16k-common`) — Apache-2.0 weights, trained on
in-house (non-VoxCeleb) data, ~7M params, ONNX export. Chosen to be commercially shippable; VoxCeleb-
trained models (WeSpeaker, SpeechBrain ECAPA) were ruled out because VoxCeleb is non-commercial. See
edmini-xz9 for the full rationale. Drop the `.onnx` at e.g. `public/models/campplus.onnx`.

## Standalone usage

```ts
import { createBrowserTargetSpeakerVad } from "@/lib/tsvad";

const vad = await createBrowserTargetSpeakerVad({ modelUrl: "/models/campplus.onnx" });
await vad.start(await navigator.mediaDevices.getUserMedia({ audio: true }));
if (!vad.isEnrolled()) await vad.enroll();        // one-time, ~2s of the target speaking
const gated = vad.getProcessedStream();           // gated MediaStream
```

Lab harness: **`/tsvad-lab`** — enroll, watch live score/gate meters, monitor the gated output.

### Guided enrollment (Capture v1)

`ui/VoiceEnrollment.tsx` is the one-screen onboarding: talk naturally ~10s with a live level meter +
progress, then an instant self-test ("say something → watch it go green"). Single enrolled speaker;
no scripted phrases (CAM++ d-vectors are text-independent) and no adaptation yet. Silence is gated out
of the centroid via an RMS floor (`level.ts`), so quiet windows never pollute enrollment.

```tsx
<VoiceEnrollment vad={vad} onComplete={(e) => /* enrolled */} onCancel={...} />
```

## Plugging into edmini (next step)

In `VoiceAgent.startSession`, between `getUserMedia` and `pc.addTrack`:

```ts
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

const vad = await createBrowserTargetSpeakerVad({ modelUrl: "/models/campplus.onnx" });
await vad.start(stream);
const outbound = vad.getProcessedStream() ?? stream;   // fall back to raw if not enrolled

outbound.getTracks().forEach((t) => pc.addTrack(t, outbound));
```

Tear down `vad.stop()` alongside the peer connection in `stopSession`.

## Open validation items (edmini-xz9)

1. CAM++ ONNX runs in the AudioWorklet path within latency budget on a phone browser.
2. Enrolled user scores clearly above a second **English** speaker (CAM++ is Mandarin-centric — try
   the bilingual zh/en variant if discrimination is weak).
3. Gate hysteresis/hang don't clip the target's sentence onsets.
4. fbank fidelity vs. Kaldi (`fbank.ts` is readable, not bit-exact) — swap to a wasm Kaldi fbank if
   scores look off.
