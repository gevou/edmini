/**
 * localStorage-backed EnrollmentStore (edmini-xz9). The enrolled centroid lives client-side next to
 * the OpenAI key — same privacy posture as the rest of edmini (nothing speaker-identifying hits a
 * server). Float32Array is serialized as a plain number array for JSON.
 */

import type { Enrollment, EnrollmentStore } from "./types";

const KEY = "tsvad_enrollment";

interface Serialized {
  centroid: number[];
  windowCount: number;
  dim: number;
  enrolledAt: number;
  name?: string;
}

export function createLocalStorageEnrollmentStore(storageKey = KEY): EnrollmentStore {
  return {
    load() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        const s = JSON.parse(raw) as Serialized;
        if (!Array.isArray(s.centroid) || s.centroid.length !== s.dim) return null;
        return {
          centroid: Float32Array.from(s.centroid),
          windowCount: s.windowCount,
          dim: s.dim,
          enrolledAt: s.enrolledAt,
          name: s.name,
        };
      } catch {
        return null;
      }
    },
    save(e: Enrollment) {
      const s: Serialized = {
        centroid: Array.from(e.centroid),
        windowCount: e.windowCount,
        dim: e.dim,
        enrolledAt: e.enrolledAt,
        name: e.name,
      };
      localStorage.setItem(storageKey, JSON.stringify(s));
    },
    clear() {
      localStorage.removeItem(storageKey);
    },
  };
}
