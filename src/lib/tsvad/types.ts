/**
 * Target-speaker VAD (edmini-xz9) — public seam.
 *
 * This module is a STANDALONE, edmini-agnostic feature: it knows nothing about VoiceAgent, the
 * Realtime API, or React. The whole point is to gate a mic MediaStream so only the *enrolled*
 * (target) speaker's audio passes through, then hand the gated stream to whatever consumes it
 * (edmini wires it between getUserMedia and pc.addTrack; the lab page wires it to an <audio>).
 *
 * Layering, innermost → outermost:
 *   1. cosine / gate / enrollment   — pure decision logic, no browser APIs (unit-tested)
 *   2. SpeakerEmbedder              — pluggable model (CAM++ ONNX in the browser; a fake in tests)
 *   3. pipeline                     — wires a MediaStream through embedder → gate → gain node
 */

/**
 * A speaker-embedding model: a window of mono PCM → a fixed-dim d-vector. The CAM++ ONNX model is
 * the production implementation; tests inject a deterministic fake. Kept async because real
 * inference (onnxruntime-web) is async and may run off the main thread.
 */
export interface SpeakerEmbedder {
  /** Embedding dimensionality (CAM++ = 192). */
  readonly dim: number;
  /** Minimum audio (ms) for a stable embedding. Scoring windows shorter than this are unreliable. */
  readonly minAudioMs: number;
  /** Sample rate (Hz) the model expects; callers must resample to this (CAM++ = 16000). */
  readonly sampleRate: number;
  /** Embed a mono Float32 PCM window (already at `sampleRate`). Need not be L2-normalized. */
  embed(samples: Float32Array): Promise<Float32Array>;
  /** Release model resources (ORT session, etc.). */
  dispose(): void;
}

/** A stored enrollment: the target speaker's centroid d-vector plus provenance for the UI. */
export interface Enrollment {
  /** L2-normalized centroid of the enrollment windows. Length === embedder.dim. */
  centroid: Float32Array;
  /** How many windows were averaged (more = more robust). */
  windowCount: number;
  /** Embedder dim, stored so a stale enrollment from a different model can be detected/rejected. */
  dim: number;
  /** Epoch ms when enrolled, for "re-enroll" prompts. */
  enrolledAt: number;
  /** Optional human name the user typed at enrollment, so edmini can address them (and label the signature). */
  name?: string;
}

/**
 * Gate tuning. Thresholds are in cosine space (the smoothed target-speaker score). Defaults are
 * STARTING POINTS — real values come from on-device tuning (see edmini-xz9 acceptance criteria).
 */
export interface GateConfig {
  /** Open when the smoothed score rises to/above this. */
  openThreshold: number;
  /** Close when the smoothed score falls to/below this. Must be < openThreshold (hysteresis band). */
  closeThreshold: number;
  /** EMA half-life (ms) for smoothing the raw per-window score. Larger = steadier but laggier. */
  emaHalfLifeMs: number;
  /** Gain rise time (ms) once open. Keep SHORT to avoid clipping the target's word onsets. */
  attackMs: number;
  /** Gain fall time (ms) once closed. */
  releaseMs: number;
  /** Hold the gate fully open this long after the score drops, before releasing — protects trailing
   *  words and brief intra-utterance dips/pauses from being chopped. */
  hangMs: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  openThreshold: 0.45,
  closeThreshold: 0.30,
  emaHalfLifeMs: 250,
  attackMs: 60,
  releaseMs: 200,
  hangMs: 350,
};

/** Per-window gate output. `gain` multiplies the outgoing audio (0 = muted, 1 = pass-through). */
export interface GateState {
  gain: number;
  open: boolean;
  smoothedScore: number;
}

/** Storage-agnostic persistence for an Enrollment (localStorage in the app; a Map in tests). */
export interface EnrollmentStore {
  load(): Enrollment | null;
  save(e: Enrollment): void;
  clear(): void;
}

/** One enrolled voice in the roster: a stable id, an optional display name, and its centroid. */
export interface RosterMember {
  id: string;
  name?: string;
  enrollment: Enrollment;
}

/** The set of enrolled voices. `principalId` names the member whose turns Ed acts on (identify-only). */
export interface Roster {
  principalId: string | null;
  members: RosterMember[];
}

export interface RosterStore {
  load(): Roster;
  save(r: Roster): void;
  clear(): void;
}
