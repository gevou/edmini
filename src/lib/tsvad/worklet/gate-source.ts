/**
 * AudioWorklet processor source for the target-speaker gate (edmini-xz9), as a self-contained string.
 *
 * Authored as a string (not a separate /public .js) so the whole feature is portable — the pipeline
 * turns it into a Blob URL and addModule()s it. AudioWorklet globals run in a separate realm, so this
 * code is plain ES with no imports.
 *
 * The processor does two things on the audio thread:
 *   1. TAP — accumulate mono input and post hop-sized frames to the main thread for speaker scoring.
 *   2. GATE — multiply output by a gain that ramps per-sample toward the target the main thread sets
 *      (per-sample ramp avoids zipper/click noise when the gate opens/closes).
 *
 * The speaker decision itself lives on the main thread (it needs the ONNX embedder); the worklet only
 * applies the resulting gain and feeds frames out.
 */
export const GATE_WORKLET_SOURCE = /* js */ `
class TsvadGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.hopSize = o.hopSize || 2048;          // samples between frame posts (at context rate)
    this.rampPerSample = o.rampPerSample || 0.0005; // max gain change per sample
    this.targetGain = o.initialGain != null ? o.initialGain : 1;
    this.currentGain = this.targetGain;
    this.buf = new Float32Array(this.hopSize);
    this.filled = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m && m.type === 'gain') this.targetGain = m.value;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const inCh = input[0];
    const outCh = output[0];
    const n = inCh ? inCh.length : 0;

    for (let i = 0; i < n; i++) {
      // Per-sample gain ramp toward target.
      if (this.currentGain < this.targetGain) {
        this.currentGain = Math.min(this.targetGain, this.currentGain + this.rampPerSample);
      } else if (this.currentGain > this.targetGain) {
        this.currentGain = Math.max(this.targetGain, this.currentGain - this.rampPerSample);
      }
      const x = inCh[i];
      // Apply gain to every output channel.
      for (let c = 0; c < output.length; c++) output[c][i] = x * this.currentGain;

      // Accumulate for the scoring tap.
      this.buf[this.filled++] = x;
      if (this.filled >= this.hopSize) {
        this.port.postMessage({ type: 'frame', samples: this.buf }, [this.buf.buffer]);
        this.buf = new Float32Array(this.hopSize);
        this.filled = 0;
      }
    }
    // Keep outCh referenced for engines that need an explicit touch.
    if (outCh && n === 0) outCh[0] = 0;
    return true;
  }
}
registerProcessor('tsvad-gate', TsvadGateProcessor);
`;
