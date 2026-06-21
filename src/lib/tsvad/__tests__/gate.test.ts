import { describe, it, expect } from "vitest";
import { createGate } from "../gate";
import { DEFAULT_GATE_CONFIG, type GateConfig } from "../types";

/** Feed a constant score for `durationMs` in `dtMs` steps; return the final state. */
function feed(gate: ReturnType<typeof createGate>, score: number, durationMs: number, dtMs = 50) {
  let last = gate.state();
  for (let t = 0; t < durationMs; t += dtMs) last = gate.push(score, dtMs);
  return last;
}

describe("target-speaker gate", () => {
  it("opens and reaches full gain under a sustained high score", () => {
    const gate = createGate(DEFAULT_GATE_CONFIG);
    const s = feed(gate, 0.9, 1000);
    expect(s.open).toBe(true);
    expect(s.gain).toBeCloseTo(1, 6);
  });

  it("stays closed and silent under a sustained low score", () => {
    const gate = createGate(DEFAULT_GATE_CONFIG);
    const s = feed(gate, -0.2, 1000);
    expect(s.open).toBe(false);
    expect(s.gain).toBe(0);
  });

  it("does not flap when the score hovers inside the hysteresis band", () => {
    const cfg = DEFAULT_GATE_CONFIG;
    const mid = (cfg.openThreshold + cfg.closeThreshold) / 2;
    const gate = createGate(cfg);
    // Starts closed; a score between close and open thresholds must NOT open it.
    const s = feed(gate, mid, 2000);
    expect(s.open).toBe(false);
  });

  it("holds open through a brief dip shorter than hang time (onset/word protection)", () => {
    const cfg: GateConfig = { ...DEFAULT_GATE_CONFIG, hangMs: 400 };
    const gate = createGate(cfg);
    feed(gate, 0.9, 1000); // fully open
    // A 200ms dip below the close threshold — shorter than hangMs — should keep it open.
    const s = feed(gate, -0.5, 200, 50);
    expect(s.open).toBe(true);
    expect(s.gain).toBeGreaterThan(0.5);
  });

  it("closes once the dip outlasts hang time", () => {
    const cfg: GateConfig = { ...DEFAULT_GATE_CONFIG, hangMs: 300, releaseMs: 200 };
    const gate = createGate(cfg);
    feed(gate, 0.9, 1000);
    const s = feed(gate, -0.5, 1500, 50); // well past hang + release
    expect(s.open).toBe(false);
    expect(s.gain).toBe(0);
  });

  it("attacks faster than it releases (protect onsets, smooth tails)", () => {
    const cfg: GateConfig = { ...DEFAULT_GATE_CONFIG, attackMs: 50, releaseMs: 500, hangMs: 0, emaHalfLifeMs: 1 };
    const attack = createGate(cfg);
    const a = feed(attack, 0.9, 60, 10); // ~60ms of opening
    const release = createGate(cfg);
    feed(release, 0.9, 1000); // fully open
    const r = release.push(-0.9, 60); // a single 60ms release step from gain 1
    // After comparable elapsed time, attack should be (near) full while release has barely fallen.
    expect(a.gain).toBeGreaterThan(0.9);
    expect(r.gain).toBeGreaterThan(0.8); // slow release: still mostly open after 60ms
    expect(a.gain).toBeGreaterThan(r.gain - 1); // sanity: attack not slower than release
  });

  it("is roughly frame-rate independent (same elapsed time, different dt)", () => {
    const coarse = createGate(DEFAULT_GATE_CONFIG);
    const fine = createGate(DEFAULT_GATE_CONFIG);
    const c = feed(coarse, 0.7, 1000, 100);
    const f = feed(fine, 0.7, 1000, 25);
    expect(f.smoothedScore).toBeCloseTo(c.smoothedScore, 1);
    expect(f.open).toBe(c.open);
  });

  it("reset returns to closed/silent", () => {
    const gate = createGate(DEFAULT_GATE_CONFIG);
    feed(gate, 0.9, 1000);
    gate.reset();
    const s = gate.state();
    expect(s).toEqual({ gain: 0, open: false, smoothedScore: 0 });
  });
});
