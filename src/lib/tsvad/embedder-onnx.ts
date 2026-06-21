/**
 * CAM++ speaker embedder via onnxruntime-web (edmini-xz9).
 *
 * Implements SpeakerEmbedder using the 3D-Speaker CAM++ model (ModelScope
 * iic/speech_campplus_sv_zh-cn_16k-common) — Apache-2.0 weights, in-house (non-VoxCeleb) training
 * data, ~7M params. See the issue's design notes for the licensing rationale and why this model.
 *
 * Pipeline: raw 16kHz mono PCM → log-mel fbank → CMN → ORT tensor [1, T, 80] → run → [1, 192].
 *
 * The ONNX input/output tensor names and feature layout differ slightly between exports, so they're
 * configurable (defaults match wespeaker/3D-Speaker CAM++). This is the one piece that needs
 * on-device validation (edmini-xz9): model URL, tensor names, and fbank fidelity must line up.
 */

// Type-only import keeps onnxruntime-web (browser/WASM) out of consumers' SSR/build graph; the real
// module is loaded lazily at create time via dynamic import.
import type * as Ort from "onnxruntime-web";
import { applyCMN, createFbankExtractor, DEFAULT_FBANK_CONFIG, type FbankConfig } from "./fbank";
import type { SpeakerEmbedder } from "./types";

export interface OnnxEmbedderOptions {
  /** URL of the CAM++ .onnx model (served from /public or a CDN you control). */
  modelUrl: string;
  /** Output embedding dim (CAM++ = 192). */
  dim?: number;
  /** Min audio (ms) for a stable embedding. */
  minAudioMs?: number;
  /** ONNX input tensor name. */
  inputName?: string;
  /** ONNX output tensor name (the embedding). If omitted, the session's first output is used. */
  outputName?: string;
  /** Feature layout: "TF" → [1, T, 80] (wespeaker default), "FT" → [1, 80, T]. */
  featureLayout?: "TF" | "FT";
  fbank?: FbankConfig;
  /** Execution providers in preference order. WASM is the safe default; WebGPU is faster if present. */
  executionProviders?: Ort.InferenceSession.ExecutionProviderConfig[];
}

export async function createOnnxCamPlusEmbedder(opts: OnnxEmbedderOptions): Promise<SpeakerEmbedder> {
  const dim = opts.dim ?? 192;
  const minAudioMs = opts.minAudioMs ?? 250;
  const layout = opts.featureLayout ?? "TF";
  const fbankCfg = opts.fbank ?? DEFAULT_FBANK_CONFIG;
  const fbank = createFbankExtractor(fbankCfg);

  const ort = await import("onnxruntime-web");
  const session = await ort.InferenceSession.create(opts.modelUrl, {
    executionProviders: opts.executionProviders ?? ["wasm"],
    graphOptimizationLevel: "all",
  });
  // Default to the model's actual tensor names — exports differ (the sherpa-onnx CAM++ uses
  // input "x" / output "embedding"; others use "feats"). Auto-detect to avoid a silent mismatch.
  const inputName = opts.inputName ?? session.inputNames[0];
  const outputName = opts.outputName ?? session.outputNames[0];

  return {
    dim,
    minAudioMs,
    sampleRate: fbankCfg.sampleRate,

    async embed(samples: Float32Array): Promise<Float32Array> {
      const frames = fbank.compute(samples);
      if (frames.length === 0) return new Float32Array(dim); // too short → empty (zero) embedding
      applyCMN(frames);

      const T = frames.length;
      const F = fbank.numMelBins;
      const flat = new Float32Array(T * F);
      if (layout === "TF") {
        for (let t = 0; t < T; t++) flat.set(frames[t], t * F);
      } else {
        for (let t = 0; t < T; t++) for (let f = 0; f < F; f++) flat[f * T + t] = frames[t][f];
      }
      const dims = layout === "TF" ? [1, T, F] : [1, F, T];
      const tensor = new ort.Tensor("float32", flat, dims);

      const result = await session.run({ [inputName]: tensor });
      const out = result[outputName];
      const data = out.data as Float32Array;
      // Some exports return [1, dim]; slice defensively to `dim`.
      return data.length === dim ? data.slice() : data.slice(0, dim);
    },

    dispose() {
      void session.release();
    },
  };
}
