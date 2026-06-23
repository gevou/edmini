/**
 * Verification EER + bootstrap CI for the speaker-embedding bake-off (edmini-txc). Pure; no I/O.
 *
 * The live gate (speaker-classifier.ts) is a VERIFICATION decision: a test utterance is scored by
 * cosine against an enrolled centroid and accepted iff it clears a threshold. The bake-off validator
 * (scripts/tsvad-validate.ts) historically reported a crude ALL-PAIRS pooled EER — every same- vs
 * different-speaker clip pair — which is not how the gate works and went non-discriminating (0%) on a
 * tiny 2-speaker set. These helpers compute the EER the gate's way (genuine = test-vs-own-centroid,
 * impostor = test-vs-other-centroid) and put a bootstrap 95% CI around it so a small-sample number
 * doesn't read as more precise than it is.
 */

export interface EerResult {
  /** Equal error rate in [0, 1] — the false-accept / false-reject rate at the crossover threshold. */
  eer: number;
  /** Cosine threshold at the equal-error point (the gate's defensible operating threshold). */
  threshold: number;
  /** Number of genuine trials (test clip vs its own speaker's centroid). */
  genuineCount: number;
  /** Number of impostor trials (test clip vs another speaker's centroid). */
  impostorCount: number;
}

export interface BootstrapCi {
  /** 2.5th-percentile EER across resamples. */
  lo: number;
  /** 97.5th-percentile EER across resamples. */
  hi: number;
  /** Number of bootstrap iterations actually run. */
  iters: number;
}

/**
 * Equal error rate for a verification task. Accept iff score >= threshold (matching the classifier's
 * `top1 >= absThreshold`). FAR(t) = fraction of impostor scores >= t; FRR(t) = fraction of genuine
 * scores < t. As t rises FAR falls and FRR climbs, crossing once; we evaluate at every distinct score
 * (the only thresholds at which the counts change), pick the crossover that minimizes |FAR - FRR|, and
 * report the EER as their average there.
 */
export function equalErrorRate(genuine: number[], impostor: number[]): EerResult {
  if (genuine.length === 0 || impostor.length === 0) {
    throw new Error(`equalErrorRate: empty score set (genuine=${genuine.length}, impostor=${impostor.length})`);
  }
  // Candidate thresholds: every distinct score value (the counts only change at these points).
  const candidates = [...new Set([...genuine, ...impostor])].sort((a, b) => a - b);

  let bestThr = candidates[0];
  let bestEer = 1;
  let bestDiff = Infinity;
  for (const thr of candidates) {
    const far = impostor.filter((s) => s >= thr).length / impostor.length;
    const frr = genuine.filter((s) => s < thr).length / genuine.length;
    const diff = Math.abs(far - frr);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestEer = (far + frr) / 2;
      bestThr = thr;
    }
  }
  return {
    eer: bestEer,
    threshold: bestThr,
    genuineCount: genuine.length,
    impostorCount: impostor.length,
  };
}

/**
 * Bootstrap 95% CI on the EER. Resamples the genuine and impostor score arrays independently, with
 * replacement, to their original sizes, recomputes the EER each iteration, and returns the 2.5/97.5
 * percentiles. Pass a seeded `rng` (see {@link mulberry32}) so the validator's reported CI is
 * reproducible across runs.
 */
export function bootstrapEerCi(
  genuine: number[],
  impostor: number[],
  opts: { iters?: number; rng?: () => number } = {},
): BootstrapCi {
  const iters = opts.iters ?? 1000;
  const rng = opts.rng ?? Math.random;
  if (genuine.length === 0 || impostor.length === 0) {
    throw new Error(`bootstrapEerCi: empty score set (genuine=${genuine.length}, impostor=${impostor.length})`);
  }

  const resample = (xs: number[]): number[] => {
    const out = new Array<number>(xs.length);
    for (let i = 0; i < xs.length; i++) out[i] = xs[(rng() * xs.length) | 0];
    return out;
  };

  const eers: number[] = [];
  for (let i = 0; i < iters; i++) {
    eers.push(equalErrorRate(resample(genuine), resample(impostor)).eer);
  }
  eers.sort((a, b) => a - b);

  return { lo: percentile(eers, 2.5), hi: percentile(eers, 97.5), iters };
}

/** Nearest-rank percentile over a pre-sorted array. */
function percentile(sorted: number[], p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

/**
 * Mulberry32 — a tiny, fast, fully deterministic PRNG. Used to seed the bootstrap so the validator's
 * CI is reproducible run-to-run (the no-Math.random rule is for Workflow scripts; tsx scripts may use
 * randomness, but a seeded generator makes a doc-able number stable).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
