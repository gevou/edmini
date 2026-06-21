/**
 * Target-speaker gate (edmini-xz9). Pure; no browser APIs — the actual "hard part" I flagged in the
 * issue is the tuning logic here, not the ML.
 *
 * Turns a stream of raw per-window target-speaker scores (cosine, ~[-1,1]) into a smoothed gain in
 * [0,1] that multiplies the outgoing audio. Four mechanisms, each guarding a specific failure mode:
 *
 *   - EMA smoothing        — kills per-window score jitter (time-based, so it's frame-rate independent)
 *   - Hysteresis           — separate open/close thresholds; no flapping when the score hovers
 *   - Hang time            — stay fully open briefly after the score drops, so brief dips and word
 *                            tails aren't chopped
 *   - Asymmetric ramps     — fast attack (don't clip onsets), slower release (smooth tail-off)
 *
 * All timing is in milliseconds and integrated against the caller-supplied dt, so the same config
 * behaves identically whether scored every 100ms or every 250ms.
 */

import type { GateConfig, GateState } from "./types";

export interface Gate {
  /** Advance by `dtMs` with the latest raw score; returns the new gain/open/smoothed state. */
  push(rawScore: number, dtMs: number): GateState;
  /** Current state without advancing. */
  state(): GateState;
  /** Reset to closed/silent (e.g. on session start or re-enroll). */
  reset(): void;
}

export function createGate(config: GateConfig): Gate {
  let smoothed = 0;
  let open = false;
  let gain = 0;
  let hangRemainingMs = 0;

  const emaAlpha = (dtMs: number): number => {
    // tau from half-life: a half-life H means alpha such that signal halves over H. Guard dt<=0.
    if (dtMs <= 0 || config.emaHalfLifeMs <= 0) return 1;
    const tau = config.emaHalfLifeMs / Math.LN2;
    return 1 - Math.exp(-dtMs / tau);
  };

  const snapshot = (): GateState => ({ gain, open, smoothedScore: smoothed });

  return {
    push(rawScore, dtMs) {
      // 1. Smooth the raw score.
      smoothed += emaAlpha(dtMs) * (rawScore - smoothed);

      // 2. Hysteresis + hang to decide the open/closed target.
      if (smoothed >= config.openThreshold) {
        open = true;
        hangRemainingMs = config.hangMs; // re-arm hang every time we're clearly the target
      } else if (smoothed <= config.closeThreshold) {
        if (open) {
          hangRemainingMs -= dtMs;
          if (hangRemainingMs <= 0) {
            open = false;
            hangRemainingMs = 0;
          }
        }
      }
      // Dead-band (between thresholds): hold current open state, freeze hang.

      // 3. Ramp gain toward the target (1 when open, 0 when closed) with asymmetric rates.
      const target = open ? 1 : 0;
      if (gain < target) {
        const step = config.attackMs > 0 ? dtMs / config.attackMs : 1;
        gain = Math.min(target, gain + step);
      } else if (gain > target) {
        const step = config.releaseMs > 0 ? dtMs / config.releaseMs : 1;
        gain = Math.max(target, gain - step);
      }

      return snapshot();
    },
    state: snapshot,
    reset() {
      smoothed = 0;
      open = false;
      gain = 0;
      hangRemainingMs = 0;
    },
  };
}
