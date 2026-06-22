/**
 * Target-speaker VAD pipeline (edmini-xz9) — the orchestrator that turns the pure core + a
 * SpeakerEmbedder into a working in-browser gate.
 *
 * Audio graph:
 *   MediaStreamSource(mic) → AudioWorkletNode('tsvad-gate') → MediaStreamDestination → processed track
 *
 * The worklet taps hop-sized frames to the main thread and applies the gain we send back. On the main
 * thread we keep a sliding window, resample it to the model's rate, embed it, score it against the
 * enrolled centroid, run the gate, and push the resulting gain to the worklet. Embedding is async and
 * may be slower than the hop, so overlapping runs are dropped (we always score the freshest window).
 *
 * Decoupled from edmini: it takes a MediaStream in and hands a gated MediaStream out. VoiceAgent will
 * call this between getUserMedia and pc.addTrack; the lab page wires the output to an <audio> element.
 */

import { createGate, type Gate } from "./gate";
import { cosineSimilarity } from "./cosine";
import { createEnrollmentAccumulator } from "./enrollment";
import { resampleLinear } from "./resample";
import { rms } from "./level";
import { GATE_WORKLET_SOURCE } from "./worklet/gate-source";
import {
  DEFAULT_GATE_CONFIG,
  type Enrollment,
  type GateConfig,
  type GateState,
  type Roster,
  type RosterMember,
  type SpeakerEmbedder,
} from "./types";
import type { CandidateScore } from "./speaker-classifier";

export interface ScoreEvent extends GateState {
  /** Raw (un-smoothed) cosine score for this window, or null when not enrolled (pass-through). */
  raw: number | null;
  enrolled: boolean;
  /** Input RMS level [0,1] for this window — drives the UI level meter. */
  level: number;
  /** Per-member cosines for this window (present when enrolled). Principal's score drives the gate. */
  scores?: CandidateScore[];
}

/** Live enrollment progress for the guided-capture UI. */
export interface EnrollProgress {
  /** Voiced windows captured so far. */
  collected: number;
  /** Target window count. */
  target: number;
  /** Current input RMS level [0,1]. */
  level: number;
  /** Whether the current window passed the voicing floor (false = too quiet, not counted). */
  voiced: boolean;
}

export interface TargetSpeakerVadOptions {
  embedder: SpeakerEmbedder;
  /**
   * Initial roster state. If omitted, the pipeline starts unenrolled.
   * The caller (createBrowserTargetSpeakerVad) loads from the RosterStore and passes it here.
   */
  roster?: Roster;
  /**
   * Called when enrollment finishes with the built Enrollment. The caller can persist it.
   * Replaces the old opts.store?.save() call, keeping the pure pipeline free of store coupling.
   */
  onEnrolled?: (e: Enrollment) => void;
  gateConfig?: GateConfig;
  /** Scoring window length (ms). Longer = steadier embeddings, more latency. */
  windowMs?: number;
  /** Frames the worklet posts this often (ms target); the real hop is rounded to a sample count. */
  hopMs?: number;
}

export interface EnrollOptions {
  /** Number of voiced windows to average into the centroid. */
  windows?: number;
  /** Give up if enrollment hasn't gathered enough windows in this long. */
  timeoutMs?: number;
  /** RMS floor below which a window is treated as silence and skipped (not counted, not averaged). */
  minLevel?: number;
  /** Called per window during capture, for the live meter/progress UI. */
  onProgress?: (p: EnrollProgress) => void;
}

export interface TargetSpeakerVad {
  /** Build the audio graph from `mic` and begin scoring/gating. Idempotent-safe to call once. */
  start(mic: MediaStream): Promise<void>;
  /** The gated output stream (feed to pc.addTrack / an <audio>). Null before start(). */
  getProcessedStream(): MediaStream | null;
  /** Capture audio and build+save the target centroid. Requires start() first. */
  enroll(opts?: EnrollOptions): Promise<Enrollment>;
  /** Set the active target (e.g. from store.load()), or null to pass-through. Back-compat. */
  setEnrollment(e: Enrollment | null): void;
  /** Replace the full roster. The principal (r.principalId) drives the gate. */
  setRoster(r: Roster): void;
  isEnrolled(): boolean;
  /** Subscribe to per-window score/gate events for meters/debug UI. Returns an unsubscribe fn. */
  onScore(cb: (e: ScoreEvent) => void): () => void;
  /** Tear down the graph and release the embedder. */
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Pure scoring helper — exported for unit tests (no ONNX / browser APIs).
// ---------------------------------------------------------------------------

/**
 * Score `emb` against each roster member's centroid. The principal's cosine becomes `raw` and
 * drives the gate decision (unchanged from the single-enrollment path). When members is empty,
 * returns raw=null so the caller can skip the gate.
 */
export function scoreWindow(
  emb: Float32Array,
  members: { id: string; enrollment: { centroid: Float32Array } }[],
  principalId: string | null,
): { scores: CandidateScore[]; raw: number | null } {
  if (!members.length) return { scores: [], raw: null };
  const scores = members.map((m) => ({ id: m.id, cosine: cosineSimilarity(emb, m.enrollment.centroid) }));
  const pid = principalId ?? members[0].id;
  return { scores, raw: scores.find((s) => s.id === pid)?.cosine ?? null };
}

// ---------------------------------------------------------------------------

export function createTargetSpeakerVad(opts: TargetSpeakerVadOptions): TargetSpeakerVad {
  const { embedder } = opts;
  const gateConfig = opts.gateConfig ?? DEFAULT_GATE_CONFIG;
  const windowMs = opts.windowMs ?? 600;
  const hopMs = opts.hopMs ?? 160;

  const gate: Gate = createGate(gateConfig);

  // Roster state — replaces the single `enrollment` field.
  let members: RosterMember[] = [];
  let principal: RosterMember | null = null;

  function applyRoster(r: Roster) {
    members = r.members;
    principal = r.members.find((m) => m.id === r.principalId) ?? r.members[0] ?? null;
  }

  // Initialise from the caller-supplied roster (if any).
  applyRoster(opts.roster ?? { principalId: null, members: [] });

  let ctx: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  let blobUrl: string | null = null;

  // Sliding window at context sample rate.
  let ring: Float32Array = new Float32Array(0);
  let ringFilled = 0;
  let minScoreSamples = 0;

  let scoring = false; // an embed() is in flight → drop overlapping hops
  let lastScoreTs = 0;

  // Enrollment mode: route scored embeddings into the accumulator instead of the gate.
  let enrolling: {
    acc: ReturnType<typeof createEnrollmentAccumulator>;
    target: number;
    minLevel: number;
    onProgress?: (p: EnrollProgress) => void;
    resolve: (e: Enrollment) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  const listeners = new Set<(e: ScoreEvent) => void>();
  const emit = (e: ScoreEvent) => listeners.forEach((l) => l(e));

  const setGain = (g: number) => node?.port.postMessage({ type: "gain", value: g });

  function pushFrame(frame: Float32Array) {
    if (ring.length === 0) return;
    if (frame.length >= ring.length) {
      ring.set(frame.subarray(frame.length - ring.length));
      ringFilled = ring.length;
    } else {
      ring.copyWithin(0, frame.length);
      ring.set(frame, ring.length - frame.length);
      ringFilled = Math.min(ring.length, ringFilled + frame.length);
    }
    void maybeScore();
  }

  async function maybeScore() {
    if (scoring || !ctx) return;
    if (ringFilled < minScoreSamples) return;

    const windowCtx = ring.slice(ring.length - ringFilled);
    const level = rms(windowCtx);

    // Pass-through when there's no target and we're not enrolling.
    if (!principal && !enrolling) {
      setGain(1);
      emit({ raw: null, enrolled: false, level, ...gate.state(), gain: 1, open: true });
      return;
    }

    // During enrollment, skip silence cheaply — before paying for an embed — so quiet windows never
    // pollute the centroid and the progress bar only advances on real speech.
    if (enrolling && level < enrolling.minLevel) {
      enrolling.onProgress?.({ collected: enrolling.acc.count, target: enrolling.target, level, voiced: false });
      setGain(1);
      emit({ raw: null, enrolled: false, level, ...gate.state(), gain: 1, open: true });
      return;
    }

    scoring = true;
    try {
      const windowModel = resampleLinear(windowCtx, ctx.sampleRate, embedder.sampleRate);
      const emb = await embedder.embed(windowModel);

      if (enrolling) {
        enrolling.acc.add(emb);
        enrolling.onProgress?.({ collected: enrolling.acc.count, target: enrolling.target, level, voiced: true });
        setGain(1); // hear yourself while enrolling
        if (enrolling.acc.count >= enrolling.target) finishEnroll();
        emit({ raw: null, enrolled: false, level, ...gate.state(), gain: 1, open: true });
      } else if (principal) {
        const { scores, raw } = scoreWindow(emb, members, principal.id);
        if (raw === null) return; // shouldn't happen when principal is set, guard anyway
        const now = performance.now();
        const dt = lastScoreTs ? now - lastScoreTs : hopMs;
        lastScoreTs = now;
        const state = gate.push(raw, dt);
        setGain(state.gain);
        emit({ raw, enrolled: true, level, scores, ...state });
      }
    } catch {
      // A bad window shouldn't wedge the loop; just skip it.
    } finally {
      scoring = false;
    }
  }

  function finishEnroll() {
    if (!enrolling) return;
    const built = enrolling.acc.build(Math.min(enrolling.target, 3));
    clearTimeout(enrolling.timer);
    const e = enrolling;
    enrolling = null;
    if (!built) {
      e.reject(new Error("enrollment: not enough usable windows"));
      return;
    }
    // Update the roster: upsert the principal member.
    applyRoster({
      principalId: "principal",
      members: [
        // keep any non-principal members already in the roster
        ...members.filter((m) => m.id !== "principal"),
        { id: "principal", name: built.name, enrollment: built },
      ],
    });
    opts.onEnrolled?.(built);
    gate.reset();
    e.resolve(built);
  }

  return {
    async start(mic) {
      if (ctx) return;
      ctx = new AudioContext();
      const blob = new Blob([GATE_WORKLET_SOURCE], { type: "application/javascript" });
      blobUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(blobUrl);

      const hopSize = Math.max(128, Math.round((hopMs / 1000) * ctx.sampleRate));
      ring = new Float32Array(Math.round((windowMs / 1000) * ctx.sampleRate));
      ringFilled = 0;
      minScoreSamples = Math.min(
        ring.length,
        Math.round((embedder.minAudioMs / 1000) * ctx.sampleRate),
      );

      source = ctx.createMediaStreamSource(mic);
      node = new AudioWorkletNode(ctx, "tsvad-gate", {
        processorOptions: { hopSize, rampPerSample: 0.0006, initialGain: principal ? 0 : 1 },
      });
      node.port.onmessage = (ev: MessageEvent) => {
        const m = ev.data as { type: string; samples?: Float32Array };
        if (m.type === "frame" && m.samples) pushFrame(m.samples);
      };
      dest = ctx.createMediaStreamDestination();
      source.connect(node).connect(dest);
    },

    getProcessedStream() {
      return dest?.stream ?? null;
    },

    enroll(enrollOpts) {
      const windows = enrollOpts?.windows ?? 12;
      const timeoutMs = enrollOpts?.timeoutMs ?? 15000;
      const minLevel = enrollOpts?.minLevel ?? 0.01;
      return new Promise<Enrollment>((resolve, reject) => {
        if (!ctx) {
          reject(new Error("enroll: call start() first"));
          return;
        }
        if (enrolling) {
          reject(new Error("enroll: already enrolling"));
          return;
        }
        const timer = setTimeout(() => {
          if (enrolling) finishEnroll(); // build with whatever we have (≥3) or reject
        }, timeoutMs);
        enrolling = {
          acc: createEnrollmentAccumulator(embedder.dim),
          target: windows,
          minLevel,
          onProgress: enrollOpts?.onProgress,
          resolve,
          reject,
          timer,
        };
      });
    },

    setEnrollment(e) {
      applyRoster(
        e
          ? { principalId: "principal", members: [{ id: "principal", name: e.name, enrollment: e }] }
          : { principalId: null, members: [] },
      );
      gate.reset();
      setGain(principal ? 0 : 1);
    },

    setRoster(r) {
      applyRoster(r);
      gate.reset();
      setGain(principal ? 0 : 1);
    },

    isEnrolled() {
      return principal !== null;
    },

    onScore(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async stop() {
      if (enrolling) {
        clearTimeout(enrolling.timer);
        enrolling.reject(new Error("enroll: stopped"));
        enrolling = null;
      }
      try {
        source?.disconnect();
        node?.disconnect();
        dest?.disconnect();
      } catch {
        /* graph already torn down */
      }
      node = null;
      source = null;
      dest = null;
      if (ctx) {
        await ctx.close();
        ctx = null;
      }
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
      embedder.dispose();
      listeners.clear();
    },
  };
}
