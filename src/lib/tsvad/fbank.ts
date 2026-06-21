/**
 * Log-mel filterbank features (edmini-xz9). Pure DSP; runs in browser or node.
 *
 * CAM++ (3D-Speaker / wespeaker ONNX exports) consumes 80-dim log-mel "fbank" features, NOT raw
 * audio — this module produces them. It targets Kaldi-style fbank (25ms window, 10ms shift, Povey
 * window, mel banks), which is what those models were trained on.
 *
 * FIDELITY CAVEAT (edmini-xz9 open validation item): this is a from-scratch, readable implementation,
 * not a bit-exact Kaldi port. Small deltas vs. kaldi-native-fbank (exact Povey window, snip-edges,
 * dithering, energy floors) can shift embeddings. Validate scores on-device before trusting the
 * gate thresholds; if accuracy is off, swap this for a wasm Kaldi fbank rather than retuning around it.
 */

export interface FbankConfig {
  sampleRate: number; // Hz (CAM++ = 16000)
  numMelBins: number; // 80
  frameLengthMs: number; // 25
  frameShiftMs: number; // 10
  lowFreq: number; // mel low edge, Hz (20)
  highFreq: number; // mel high edge, Hz (0 → sampleRate/2)
  preEmphasis: number; // 0.97
}

export const DEFAULT_FBANK_CONFIG: FbankConfig = {
  sampleRate: 16000,
  numMelBins: 80,
  frameLengthMs: 25,
  frameShiftMs: 10,
  lowFreq: 20,
  highFreq: 0,
  preEmphasis: 0.97,
};

const hzToMel = (hz: number): number => 1127 * Math.log(1 + hz / 700);
const melToHz = (mel: number): number => 700 * (Math.exp(mel / 1127) - 1);

/** Triangular mel filterbank weights over the (rfft) power-spectrum bins. Built once per config. */
function melFilterbank(cfg: FbankConfig, fftSize: number): Float32Array[] {
  const nBins = fftSize / 2 + 1;
  const high = cfg.highFreq > 0 ? cfg.highFreq : cfg.sampleRate / 2;
  const melLow = hzToMel(cfg.lowFreq);
  const melHigh = hzToMel(high);
  // numMelBins triangles need numMelBins+2 mel edge points.
  const edges = new Float32Array(cfg.numMelBins + 2);
  for (let i = 0; i < edges.length; i++) {
    edges[i] = melToHz(melLow + ((melHigh - melLow) * i) / (cfg.numMelBins + 1));
  }
  const binHz = cfg.sampleRate / fftSize;
  const filters: Float32Array[] = [];
  for (let m = 1; m <= cfg.numMelBins; m++) {
    const left = edges[m - 1];
    const center = edges[m];
    const right = edges[m + 1];
    const w = new Float32Array(nBins);
    for (let k = 0; k < nBins; k++) {
      const f = k * binHz;
      if (f >= left && f <= center) w[k] = (f - left) / (center - left);
      else if (f > center && f <= right) w[k] = (right - f) / (right - center);
    }
    filters.push(w);
  }
  return filters;
}

/** Povey window (Kaldi default): Hann raised to 0.85. */
function poveyWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)), 0.85);
  }
  return w;
}

const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};

/**
 * In-place iterative radix-2 Cooley–Tukey FFT. `re`/`im` length must be a power of two. Adequate for
 * one 25ms frame (≤512-pt at 16kHz); not a performance-tuned kernel.
 */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

export interface FbankExtractor {
  /** [numFrames][numMelBins] log-mel features for a mono PCM window. May be empty if too short. */
  compute(samples: Float32Array): Float32Array[];
  readonly numMelBins: number;
}

export function createFbankExtractor(config: FbankConfig = DEFAULT_FBANK_CONFIG): FbankExtractor {
  const frameLen = Math.round((config.frameLengthMs / 1000) * config.sampleRate);
  const frameShift = Math.round((config.frameShiftMs / 1000) * config.sampleRate);
  const fftSize = nextPow2(frameLen);
  const window = poveyWindow(frameLen);
  const filters = melFilterbank(config, fftSize);
  const nBins = fftSize / 2 + 1;

  return {
    numMelBins: config.numMelBins,
    compute(samples) {
      const frames: Float32Array[] = [];
      if (samples.length < frameLen) return frames;
      const re = new Float32Array(fftSize);
      const im = new Float32Array(fftSize);
      for (let start = 0; start + frameLen <= samples.length; start += frameShift) {
        re.fill(0);
        im.fill(0);
        // Pre-emphasis + Povey window into the (zero-padded) FFT buffer.
        let prev = samples[start];
        for (let i = 0; i < frameLen; i++) {
          const x = samples[start + i];
          const emph = x - config.preEmphasis * prev;
          prev = x;
          re[i] = emph * window[i];
        }
        fft(re, im);
        const mel = new Float32Array(config.numMelBins);
        for (let m = 0; m < config.numMelBins; m++) {
          const w = filters[m];
          let acc = 0;
          for (let k = 0; k < nBins; k++) {
            if (w[k] !== 0) {
              const power = re[k] * re[k] + im[k] * im[k];
              acc += power * w[k];
            }
          }
          // log with a small floor to avoid log(0).
          mel[m] = Math.log(Math.max(acc, 1e-10));
        }
        frames.push(mel);
      }
      return frames;
    },
  };
}

/** Per-utterance cepstral mean normalization (CMN) over the time axis, in place. CAM++ expects it. */
export function applyCMN(frames: Float32Array[]): void {
  if (frames.length === 0) return;
  const dim = frames[0].length;
  const mean = new Float32Array(dim);
  for (const f of frames) for (let i = 0; i < dim; i++) mean[i] += f[i];
  for (let i = 0; i < dim; i++) mean[i] /= frames.length;
  for (const f of frames) for (let i = 0; i < dim; i++) f[i] -= mean[i];
}
