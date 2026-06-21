/**
 * Audio level helpers (edmini-xz9). Pure. Used by the enrollment UI's quality meter and to gate
 * silence out of enrollment, so a quiet/empty window never pollutes the centroid.
 */

/** Root-mean-square amplitude of a PCM window, in [0, 1] for normalized float audio. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  return Math.sqrt(sumSq / samples.length);
}

/** RMS as dBFS (−∞…0). Handy for log-scaled meters; floored at −100 to avoid −Infinity. */
export function dbfs(rmsValue: number): number {
  return rmsValue <= 1e-5 ? -100 : 20 * Math.log10(rmsValue);
}

/**
 * Whether a window carries enough energy to be speech rather than silence/room noise. `floor` is an
 * RMS threshold (default chosen for typical mic input; tune per device). Deliberately crude — it
 * only needs to reject obvious silence during enrollment, not do real VAD.
 */
export function isVoiced(samples: Float32Array, floor = 0.01): boolean {
  return rms(samples) >= floor;
}
