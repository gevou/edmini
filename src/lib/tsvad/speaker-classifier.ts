/**
 * N-speaker classifier with top1-top2 margin (edmini-ce9; generalizes for edmini-q1e).
 *
 * Pure reducer over per-window cosine scores against an N-speaker roster. Where the single-target
 * utterance-grader answers "is this the one enrolled user?" with an absolute threshold, this answers
 * "which of N enrolled speakers (if any) is this?" — and crucially refuses to guess.
 *
 * The accuracy lever (roadmap §"Accuracy — the model is the lever", item 3): an absolute threshold
 * alone lets an UNENROLLED 6th person spuriously match whichever enrolled centroid happens to sit
 * highest. So acceptance requires BOTH:
 *
 *   1. top1 >= absThreshold        — the best centroid is a genuine match, not just the least-bad, AND
 *   2. top1 - top2 >= marginThreshold  — it clearly beats the runner-up (the next-best centroid, or the
 *      "unknown floor" when there's only one candidate).
 *
 * Anything short of both → "unknown". Uncertain never guesses (the cost of a wrong positive ID in a
 * roster is mislabeling a turn as the wrong person; "unknown" is the safe classification).
 *
 * Single-centroid back-compat: with one candidate there is no runner-up, so top2 falls back to
 * `unknownFloor` (default 0). The margin check then reduces to `top1 - unknownFloor >= marginThreshold`,
 * i.e. a second absolute bar. Set unknownFloor=0 and marginThreshold<=absThreshold (the defaults) and
 * single-target acceptance is governed by absThreshold exactly as before.
 *
 * Like the utterance-grader, this grades the COMPLETED utterance: scores are averaged per candidate
 * over VOICED windows only (silence carries no speaker evidence), then top1/top2 are taken over the
 * per-candidate means. Pure: no React, no I/O.
 */

/** One candidate centroid's cosine for a single window. */
export interface CandidateScore {
  /** Speaker id / roster label. */
  id: string;
  /** Cosine similarity of this window's embedding to that speaker's centroid, in [-1, 1]. */
  cosine: number;
}

export interface ClassifierPolicy {
  /** top1 must reach this to be a genuine match (not merely the least-bad centroid). */
  absThreshold?: number;
  /** top1 must beat top2 (or the unknown floor) by at least this much, else "unknown". */
  marginThreshold?: number;
  /** Stand-in runner-up score when there is only one candidate (no real top2). */
  unknownFloor?: number;
  /** Minimum voiced windows before any positive ID is trusted (speaker-ID needs ~1s of voiced audio). */
  minVoicedWindows?: number;
  /** RMS floor below which a window is treated as silence and excluded from the means. */
  voicedLevelFloor?: number;
}

export const DEFAULT_CLASSIFIER_POLICY: Required<ClassifierPolicy> = {
  // absThreshold mirrors the grader's respondThreshold (0.35) — a genuine match floor in cosine space.
  absThreshold: 0.35,
  // marginThreshold: with the winning CAM++ zh_en model, diff-speaker mean cosine ≈ 0.29 and
  // same-speaker ≈ 0.83 (margin ≈ 0.54), so a 0.10 gap between top1 and top2 is comfortably
  // separable while still rejecting genuinely ambiguous near-ties. Conservative on purpose: when in
  // doubt, "unknown" beats a confident mislabel.
  marginThreshold: 0.1,
  unknownFloor: 0,
  minVoicedWindows: 4,
  voicedLevelFloor: 0.015,
};

export interface ClassifyDecision {
  /** Winning speaker id, or "unknown" when no candidate clears both the absolute and margin bars. */
  label: string;
  /** Mean cosine of the best candidate over voiced windows (or 0 with no evidence). */
  top1: number;
  /** Id of the runner-up candidate, or null when there was none (single-target). */
  top2Id: string | null;
  /** Mean cosine of the runner-up, or the unknown floor when there was none. */
  top2: number;
  /** top1 - top2 (the separation that must clear marginThreshold). */
  margin: number;
  /** Number of voiced windows that contributed to the means. */
  voicedWindows: number;
}

export interface SpeakerClassifier {
  begin(): void;
  /** Add one window's per-candidate cosines plus the window RMS level (for the voiced floor). */
  addWindow(scores: CandidateScore[], level: number): void;
  end(): ClassifyDecision;
}

export function createSpeakerClassifier(policy: ClassifierPolicy = {}): SpeakerClassifier {
  const absThreshold = policy.absThreshold ?? DEFAULT_CLASSIFIER_POLICY.absThreshold;
  const marginThreshold = policy.marginThreshold ?? DEFAULT_CLASSIFIER_POLICY.marginThreshold;
  const unknownFloor = policy.unknownFloor ?? DEFAULT_CLASSIFIER_POLICY.unknownFloor;
  const minVoicedWindows = policy.minVoicedWindows ?? DEFAULT_CLASSIFIER_POLICY.minVoicedWindows;
  const voicedLevelFloor = policy.voicedLevelFloor ?? DEFAULT_CLASSIFIER_POLICY.voicedLevelFloor;

  const sums = new Map<string, number>();
  let voiced = 0;

  const unknown = (top1 = 0, top2Id: string | null = null, top2 = unknownFloor): ClassifyDecision => ({
    label: "unknown",
    top1,
    top2Id,
    top2,
    margin: top1 - top2,
    voicedWindows: voiced,
  });

  return {
    begin() {
      sums.clear();
      voiced = 0;
    },

    addWindow(scores, level) {
      if (level < voicedLevelFloor) return; // silence carries no speaker evidence
      if (scores.length === 0) return;
      voiced += 1;
      for (const { id, cosine } of scores) sums.set(id, (sums.get(id) ?? 0) + cosine);
    },

    end(): ClassifyDecision {
      if (voiced === 0 || sums.size === 0) return unknown();

      // Per-candidate mean cosine over voiced windows, sorted high → low.
      const means = [...sums.entries()]
        .map(([id, sum]) => ({ id, mean: sum / voiced }))
        .sort((a, b) => b.mean - a.mean);

      const top1 = means[0].mean;
      const runnerUp = means[1] ?? null;
      const top2 = runnerUp ? runnerUp.mean : unknownFloor;
      const top2Id = runnerUp ? runnerUp.id : null;
      const margin = top1 - top2;

      // Not enough voiced audio to trust any positive ID — never guess.
      if (voiced < minVoicedWindows) {
        return { label: "unknown", top1, top2Id, top2, margin, voicedWindows: voiced };
      }

      const accept = top1 >= absThreshold && margin >= marginThreshold;
      return {
        label: accept ? means[0].id : "unknown",
        top1,
        top2Id,
        top2,
        margin,
        voicedWindows: voiced,
      };
    },
  };
}
