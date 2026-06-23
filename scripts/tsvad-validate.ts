/**
 * Offline validation harness for target-speaker VAD (edmini-xz9).
 *
 *   pnpm tsvad:validate [modelPath] [wavDir]
 *
 * Reuses the REAL feature pipeline (src/lib/tsvad/fbank + cosine) and runs it through onnxruntime-node,
 * so it validates the actual code, not a reimplementation. It reports:
 *   1. the model's true I/O contract (names + embedding dim) — set these in createOnnxCamPlusEmbedder
 *   2. speaker separation: mean cosine for same-speaker vs different-speaker pairs (+ the separation margin)
 *   3. two EERs: a VERIFICATION EER that mirrors the live gate (enroll-clips → centroid, test-clips →
 *      cosine vs centroids; genuine = vs-own, impostor = vs-other) with a bootstrap 95% CI, plus the old
 *      ALL-PAIRS pooled EER for continuity (clearly labeled — it is not how the gate actually decides)
 *   4. per-window embed latency (node, wasm/native — indicative, not a phone number)
 *
 * With no args it uses scripts/fixtures/synthetic_campplus.onnx and synthetic "voices" (distinct
 * spectra) — this proves the plumbing in CI where the real weights are network-blocked. Point it at the
 * real CAM++ .onnx and a folder of `<speakerId>_<utt>.wav` (16 kHz mono 16-bit) to validate accuracy:
 *
 *   pnpm tsvad:validate ./campplus.onnx ./samples
 */
import * as ort from "onnxruntime-node";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createFbankExtractor, applyCMN } from "../src/lib/tsvad/fbank";
import { cosineSimilarity } from "../src/lib/tsvad/cosine";
import { createEnrollmentAccumulator } from "../src/lib/tsvad/enrollment";
import { equalErrorRate, bootstrapEerCi, mulberry32 } from "../src/lib/tsvad/eer";

const MODEL = process.argv[2] ?? "scripts/fixtures/synthetic_campplus.onnx";
const WAV_DIR = process.argv[3];
const INPUT_NAME = process.env.TSVAD_INPUT_NAME; // default: the model's actual first input (auto-detected)
const SR = 16000;

const fbank = createFbankExtractor();

async function embed(session: ort.InferenceSession, samples: Float32Array): Promise<Float32Array> {
  const frames = fbank.compute(samples);
  applyCMN(frames);
  const T = frames.length;
  const F = fbank.numMelBins;
  const flat = new Float32Array(T * F);
  for (let t = 0; t < T; t++) flat.set(frames[t], t * F);
  const tensor = new ort.Tensor("float32", flat, [1, T, F]);
  const out = await session.run({ [INPUT_NAME ?? session.inputNames[0]]: tensor });
  return (out[session.outputNames[0]].data as Float32Array).slice();
}

/** Deterministic pseudo-speech: pitch harmonics shaped by 3 formants, with a speech-like envelope. */
function synthVoice(voiceId: number, utt: number, ms = 1200): Float32Array {
  const n = Math.round((ms / 1000) * SR);
  const out = new Float32Array(n);
  const f0 = 100 + voiceId * 35; // distinct pitch per voice
  const formants = [500 + voiceId * 180, 1500 + voiceId * 220, 2500 + voiceId * 200];
  const jitter = 1 + (utt - 1) * 0.01; // small per-utterance variation
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let h = 1; h <= 18; h++) {
      const freq = f0 * h * jitter;
      let amp = 1 / h;
      for (const fmt of formants) amp *= 1 / (1 + ((freq - fmt) / 220) ** 2); // formant peaks
      s += amp * Math.sin(2 * Math.PI * freq * t);
    }
    const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t); // ~4 Hz syllable envelope
    out[i] = s * env * 0.2;
  }
  return out;
}

/** Minimal 16-bit mono PCM WAV reader. */
function loadWav(path: string): Float32Array {
  const buf = readFileSync(path);
  const dataOffset = 44; // standard PCM header
  const samples = new Float32Array((buf.length - dataOffset) / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  return samples;
}

function meanCosine(pairs: [Float32Array, Float32Array][]): number {
  return pairs.reduce((a, [x, y]) => a + cosineSimilarity(x, y), 0) / Math.max(1, pairs.length);
}

/** Build a speaker centroid from clip embeddings via the REAL enrollment recipe (per-window L2 → mean → L2). */
function centroid(embeddings: Float32Array[], dim: number): Float32Array {
  const acc = createEnrollmentAccumulator(dim);
  for (const e of embeddings) acc.add(e);
  return acc.build(1)!.centroid;
}

/**
 * Verification scores the way the live gate decides: for each speaker, hold out one clip as the test
 * utterance and build that speaker's centroid from the REMAINING clips (leave-one-out — no leakage, and
 * it uses every clip on small sets). Genuine = held-out clip vs its own LOO centroid. Impostor = that
 * same clip vs every OTHER speaker's full centroid (the false-accept scenario: a stranger scored against
 * an enrolled roster). Speakers with <2 clips contribute no genuine trials (no held-out centroid).
 */
function verificationScores(bySpeaker: Map<string, Float32Array[]>, dim: number) {
  const ids = [...bySpeaker.keys()];
  const fullCentroid = new Map(ids.map((id) => [id, centroid(bySpeaker.get(id)!, dim)]));
  const genuine: number[] = [];
  const impostor: number[] = [];
  for (const id of ids) {
    const clips = bySpeaker.get(id)!;
    for (let i = 0; i < clips.length; i++) {
      if (clips.length >= 2) {
        const enroll = clips.filter((_, j) => j !== i);
        genuine.push(cosineSimilarity(clips[i], centroid(enroll, dim)));
      }
      for (const other of ids) {
        if (other === id) continue;
        impostor.push(cosineSimilarity(clips[i], fullCentroid.get(other)!));
      }
    }
  }
  return { genuine, impostor };
}

async function main() {
  console.log(`\n● Model: ${MODEL}`);
  const session = await ort.InferenceSession.create(MODEL);
  console.log(`  inputs:  ${session.inputNames.join(", ")}`);
  console.log(`  outputs: ${session.outputNames.join(", ")}`);

  // Build embeddings grouped by speaker.
  const bySpeaker = new Map<string, Float32Array[]>();
  const latencies: number[] = [];
  const run = async (id: string, samples: Float32Array) => {
    const t0 = performance.now();
    const e = await embed(session, samples);
    latencies.push(performance.now() - t0);
    (bySpeaker.get(id) ?? bySpeaker.set(id, []).get(id)!).push(e);
  };

  if (WAV_DIR) {
    const files = readdirSync(WAV_DIR).filter((f) => f.endsWith(".wav"));
    for (const f of files) await run(f.split("_")[0], loadWav(join(WAV_DIR, f)));
    console.log(`  source:  ${files.length} wavs from ${WAV_DIR}`);
  } else {
    for (let v = 0; v < 4; v++) for (let u = 1; u <= 4; u++) await run(`voice${v}`, synthVoice(v, u));
    console.log(`  source:  synthetic (4 voices × 4 utterances)`);
  }

  const dim = [...bySpeaker.values()][0][0].length;
  console.log(`  embedding dim: ${dim}\n`);

  // Same-speaker vs different-speaker cosine pairs.
  const ids = [...bySpeaker.keys()];
  const same: [Float32Array, Float32Array][] = [];
  const diff: [Float32Array, Float32Array][] = [];
  for (const id of ids) {
    const es = bySpeaker.get(id)!;
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) same.push([es[i], es[j]]);
  }
  for (let a = 0; a < ids.length; a++)
    for (let b = a + 1; b < ids.length; b++)
      for (const x of bySpeaker.get(ids[a])!) for (const y of bySpeaker.get(ids[b])!) diff.push([x, y]);

  const sameMean = meanCosine(same);
  const diffMean = meanCosine(diff);
  const margin = sameMean - diffMean;

  // ALL-PAIRS pooled EER (kept for continuity; NOT how the gate decides): sweep a threshold over every
  // same-pair vs diff-pair cosine, track where max(false-accept, false-reject) is smallest.
  let bestThr = 0;
  let bestEer = 1;
  for (let thr = -1; thr <= 1; thr += 0.01) {
    const far = diff.filter(([x, y]) => cosineSimilarity(x, y) >= thr).length / diff.length;
    const frr = same.filter(([x, y]) => cosineSimilarity(x, y) < thr).length / same.length;
    if (Math.max(far, frr) < bestEer) {
      bestEer = Math.max(far, frr);
      bestThr = thr;
    }
  }

  // VERIFICATION EER — mirrors the live gate (enroll → centroid, test clip → cosine vs centroids), with
  // a bootstrap 95% CI so a small-sample number doesn't read as more precise than it is.
  const { genuine, impostor } = verificationScores(bySpeaker, dim);
  const haveVerif = genuine.length > 0 && impostor.length > 0;
  const verif = haveVerif ? equalErrorRate(genuine, impostor) : null;
  const ci = haveVerif ? bootstrapEerCi(genuine, impostor, { iters: 1000, rng: mulberry32(42) }) : null;

  const avgLat = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`  same-speaker cosine:  ${sameMean.toFixed(3)}`);
  console.log(`  diff-speaker cosine:  ${diffMean.toFixed(3)}`);
  console.log(`  separation margin:    ${margin.toFixed(3)}`);
  if (verif && ci) {
    console.log(
      `  verification EER:     ${(verif.eer * 100).toFixed(1)}%  ` +
        `(95% CI ${(ci.lo * 100).toFixed(1)}–${(ci.hi * 100).toFixed(1)}%, ${ci.iters} boot; ` +
        `thr ${verif.threshold.toFixed(2)}; ${verif.genuineCount} genuine / ${verif.impostorCount} impostor)`,
    );
  } else {
    console.log(`  verification EER:     n/a (need ≥2 clips for ≥1 speaker + ≥2 speakers)`);
  }
  console.log(`  all-pairs EER:        ${(bestEer * 100).toFixed(1)}%  (pooled, indicative; thr ${bestThr.toFixed(2)})`);
  console.log(`  embed latency (node): ${avgLat.toFixed(1)} ms/window avg\n`);

  const ok = dim > 0 && margin > 0.05;
  console.log(ok
    ? "✓ Plumbing validated: fbank → ONNX → cosine runs and separates speakers consistently."
    : "✗ No usable separation — check input name/layout/fbank against the model.");
  if (!WAV_DIR) console.log("  (synthetic model — for real accuracy, pass the CAM++ .onnx + a wav dir)");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
