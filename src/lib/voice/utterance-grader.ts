/**
 * Utterance grader (edmini-5y7) — pure reducer over the TS-VAD per-window scores for one user turn.
 * Decides whether edmini should respond. Speaker-ID is text-independent and needs ~1s of voiced audio
 * to be confident, so we grade the COMPLETED utterance (all windows in hand) rather than gating live.
 *
 * Policy: mean cosine over VOICED windows (silence carries no speaker evidence). Bias to `respond` when
 * uncertain — a missed bystander is a minor blip, but refusing the user's quick "stop" is a bad failure.
 * Not enrolled (raw === null) → always respond (pass-through). Pure: no React, no I/O.
 */
export interface GraderPolicy {
  respondThreshold?: number;
  minVoicedWindows?: number;
  voicedLevelFloor?: number;
}

export interface GradeDecision {
  decision: "respond" | "suppress";
  confidence: number;
  voicedWindows: number;
}

export interface UtteranceGrader {
  begin(): void;
  addScore(raw: number | null, level: number): void;
  end(): GradeDecision;
}

export function createUtteranceGrader(policy: GraderPolicy = {}): UtteranceGrader {
  // 0.30 (edmini-1oa): on-device, the principal's own voice scores ~0.44–0.48 after a clean longer
  // enrollment (f1l) — above 0.35 but thin margin; strangers score ~0.05–0.15, so 0.30 widens the
  // principal's headroom (~0.14–0.18) while still rejecting non-principals. Re-tune per device/environment.
  const respondThreshold = policy.respondThreshold ?? 0.30;
  const minVoicedWindows = policy.minVoicedWindows ?? 4;
  const voicedLevelFloor = policy.voicedLevelFloor ?? 0.015;

  let sum = 0;
  let voiced = 0;
  let sawEnrolledScore = false;

  return {
    begin() { sum = 0; voiced = 0; sawEnrolledScore = false; },
    addScore(raw, level) {
      if (raw === null) return;
      sawEnrolledScore = true;
      if (level < voicedLevelFloor) return;
      sum += raw;
      voiced += 1;
    },
    end(): GradeDecision {
      const confidence = voiced > 0 ? sum / voiced : 0;
      if (!sawEnrolledScore || voiced < minVoicedWindows) {
        return { decision: "respond", confidence, voicedWindows: voiced };
      }
      return { decision: confidence >= respondThreshold ? "respond" : "suppress", confidence, voicedWindows: voiced };
    },
  };
}
