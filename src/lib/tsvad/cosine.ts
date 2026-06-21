/**
 * Cosine scoring for d-vectors (edmini-xz9). Pure; no browser APIs.
 *
 * Target-speaker score = cosine similarity between a live window's embedding and the enrolled
 * centroid. For L2-normalized vectors this is just a dot product, but we compute norms here so
 * callers can pass raw embeddings safely.
 */

/** Return a new L2-normalized copy of `v`. A zero vector is returned unchanged (norm 0 → no-op). */
export function l2normalize(v: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
  const norm = Math.sqrt(sumSq);
  const out = new Float32Array(v.length);
  if (norm === 0) return out;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/**
 * Cosine similarity in [-1, 1]. Length-mismatched inputs throw (a dim mismatch means a stale
 * enrollment from a different model — fail loud rather than silently misgate). A zero-norm input
 * yields 0 (undefined direction → treat as "no match").
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dim mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let aSq = 0;
  let bSq = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aSq += a[i] * a[i];
    bSq += b[i] * b[i];
  }
  const denom = Math.sqrt(aSq) * Math.sqrt(bSq);
  return denom === 0 ? 0 : dot / denom;
}
