/**
 * Enrollment accumulator (edmini-xz9). Pure; no browser APIs.
 *
 * Builds the target speaker's centroid d-vector from several short windows captured during a
 * one-time "enroll" step. Standard d-vector recipe: L2-normalize each window embedding, average
 * them, then L2-normalize the mean. Per-window normalization stops one loud window from dominating;
 * the final normalization makes the centroid directly comparable via dot product.
 */

import { l2normalize } from "./cosine";
import type { Enrollment } from "./types";

export interface EnrollmentAccumulator {
  /** Fold one window embedding into the running centroid. */
  add(embedding: Float32Array): void;
  /** Windows accumulated so far. */
  readonly count: number;
  /** Finalize into an Enrollment, or null if fewer than `minWindows` were added. */
  build(minWindows?: number): Enrollment | null;
  reset(): void;
}

export function createEnrollmentAccumulator(dim: number): EnrollmentAccumulator {
  // Running sum of L2-normalized embeddings; mean = sum / count, re-normalized at build().
  let sum = new Float32Array(dim);
  let count = 0;

  return {
    add(embedding) {
      if (embedding.length !== dim) {
        throw new Error(`enrollment: dim mismatch ${embedding.length} vs ${dim}`);
      }
      const unit = l2normalize(embedding);
      for (let i = 0; i < dim; i++) sum[i] += unit[i];
      count++;
    },
    get count() {
      return count;
    },
    build(minWindows = 1) {
      if (count < minWindows) return null;
      const mean = new Float32Array(dim);
      for (let i = 0; i < dim; i++) mean[i] = sum[i] / count;
      return {
        centroid: l2normalize(mean),
        windowCount: count,
        dim,
        enrolledAt: Date.now(),
      };
    },
    reset() {
      sum = new Float32Array(dim);
      count = 0;
    },
  };
}
