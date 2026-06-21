/**
 * Linear resampling (edmini-xz9). Pure. The browser's AudioContext runs at 44.1/48kHz but CAM++
 * expects 16kHz, so each scoring window is downsampled before fbank.
 *
 * Linear interpolation is intentionally cheap. It lacks a proper anti-aliasing low-pass, but for
 * speaker-embedding features (which already integrate energy into broad mel bands) it's adequate;
 * if on-device accuracy demands it, swap in a windowed-sinc resampler behind this same signature.
 */
export function resampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate || input.length === 0) return input;
  const ratio = outRate / inRate;
  const outLen = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}
