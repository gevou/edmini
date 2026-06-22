/**
 * Target-speaker VAD (edmini-xz9) — public surface.
 *
 * Standalone, edmini-agnostic: gate a mic MediaStream so only the enrolled speaker passes through.
 *
 * Quick start (browser):
 *
 *   const vad = await createBrowserTargetSpeakerVad({ modelUrl: "/models/campplus.onnx" });
 *   await vad.start(await navigator.mediaDevices.getUserMedia({ audio: true }));
 *   if (!vad.isEnrolled()) await vad.enroll();      // one-time, ~2s of the target speaking
 *   const gated = vad.getProcessedStream();          // → pc.addTrack(gated.getAudioTracks()[0], gated)
 *
 * The pure core (cosine / gate / enrollment / fbank / resample) is exported too, for testing and for
 * swapping in a different SpeakerEmbedder.
 */

export * from "./types";
export { cosineSimilarity, l2normalize } from "./cosine";
export { createGate, type Gate } from "./gate";
export { createLocalStorageRosterStore } from "./roster-store";
export {
  createSpeakerClassifier,
  DEFAULT_CLASSIFIER_POLICY,
  type SpeakerClassifier,
  type ClassifierPolicy,
  type ClassifyDecision,
  type CandidateScore,
} from "./speaker-classifier";
export { createEnrollmentAccumulator, type EnrollmentAccumulator } from "./enrollment";
export { createFbankExtractor, applyCMN, DEFAULT_FBANK_CONFIG, type FbankConfig } from "./fbank";
export { resampleLinear } from "./resample";
export { rms, dbfs, isVoiced } from "./level";
export { createOnnxCamPlusEmbedder, type OnnxEmbedderOptions } from "./embedder-onnx";
export { createLocalStorageEnrollmentStore } from "./enrollment-store";
export {
  createTargetSpeakerVad,
  type TargetSpeakerVad,
  type TargetSpeakerVadOptions,
  type ScoreEvent,
  type EnrollOptions,
  type EnrollProgress,
} from "./pipeline";

import { createOnnxCamPlusEmbedder, type OnnxEmbedderOptions } from "./embedder-onnx";
import { createLocalStorageEnrollmentStore } from "./enrollment-store";
import { createTargetSpeakerVad, type TargetSpeakerVad, type TargetSpeakerVadOptions } from "./pipeline";

/**
 * Where the speaker-embedding ONNX is served from. Prod points at the Vercel Blob URL (the ~28 MB model
 * is gitignored, so it isn't in the deployed bundle) via NEXT_PUBLIC_TSVAD_MODEL_URL; local dev falls back
 * to the file in public/models. The chosen model is CAM++ zh_en (edmini-ce9 bake-off / edmini-5on).
 */
export const TSVAD_MODEL_URL =
  process.env.NEXT_PUBLIC_TSVAD_MODEL_URL ?? "/models/campplus.onnx";

export interface BrowserTargetSpeakerVadOptions
  extends Omit<TargetSpeakerVadOptions, "embedder" | "store"> {
  /** URL of the CAM++ ONNX model (e.g. "/models/campplus.onnx"). */
  modelUrl: string;
  /** Override embedder options (tensor names, layout, execution providers). */
  embedderOptions?: Partial<OnnxEmbedderOptions>;
  /** localStorage key for the enrollment (default: tsvad_enrollment). */
  storageKey?: string;
}

/** Build the production stack (CAM++ ONNX + localStorage enrollment) in one call. */
export async function createBrowserTargetSpeakerVad(
  opts: BrowserTargetSpeakerVadOptions,
): Promise<TargetSpeakerVad> {
  const embedder = await createOnnxCamPlusEmbedder({
    modelUrl: opts.modelUrl,
    ...opts.embedderOptions,
  });
  return createTargetSpeakerVad({
    embedder,
    store: createLocalStorageEnrollmentStore(opts.storageKey),
    gateConfig: opts.gateConfig,
    windowMs: opts.windowMs,
    hopMs: opts.hopMs,
  });
}
