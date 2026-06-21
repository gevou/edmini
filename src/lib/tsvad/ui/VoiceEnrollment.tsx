"use client";

/**
 * Guided voice enrollment — "Capture v1" for target-speaker VAD (edmini-xz9).
 *
 * One screen, three phases, single enrolled speaker:
 *   1. intro     — explain; tap to start
 *   2. recording — read the on-screen passage (~10s); live level meter + progress; silence skipped
 *   3. verify    — instant self-test: say something, watch the gate light up green; confirm or redo
 *
 * The passage is a UX aid only (people freeze when told "just talk"): CAM++ d-vectors are
 * text-independent, so ANY connected speech works — we show a sentence so there's something to say,
 * not because the words matter. NOT a multi-step scripted wizard. Adaptation/multi-speaker are out of
 * scope for v1 (see edmini-xz9).
 *
 * Decoupled & reusable: takes an already-started TargetSpeakerVad and reports completion. The lab page
 * uses it now; VoiceAgent can drop it into onboarding later.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Enrollment } from "../types";
import type { EnrollProgress, ScoreEvent, TargetSpeakerVad } from "../pipeline";

type Step = "intro" | "recording" | "verify" | "error";

/** ~11s of neutral, phonetically varied speech (the standard "Rainbow Passage" opening). The words
 *  don't matter to the model — this just gives the user something to say so they don't freeze. */
const SAMPLE_PASSAGE =
  "When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow. " +
  "The rainbow is a division of white light into many beautiful colors.";

export interface VoiceEnrollmentProps {
  vad: TargetSpeakerVad;
  onComplete: (e: Enrollment) => void;
  onCancel?: () => void;
  /** Target voiced windows to capture (~30 ≈ 8–12s of speech depending on embed speed). */
  windows?: number;
  /** RMS floor for "this is speech, not silence." Tune per device. */
  minLevel?: number;
}

export function VoiceEnrollment({
  vad,
  onComplete,
  onCancel,
  windows = 30,
  minLevel = 0.015,
}: VoiceEnrollmentProps) {
  const [step, setStep] = useState<Step>("intro");
  const [progress, setProgress] = useState<EnrollProgress | null>(null);
  const [selfTest, setSelfTest] = useState<ScoreEvent | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const enrollmentRef = useRef<Enrollment | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const cleanupSelfTest = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
  }, []);

  const startSelfTest = useCallback(() => {
    setSelfTest(null);
    setStep("verify");
    unsubRef.current = vad.onScore((e) => setSelfTest(e));
  }, [vad]);

  const startCapture = useCallback(() => {
    setErrorMsg(null);
    setProgress({ collected: 0, target: windows, level: 0, voiced: false });
    setStep("recording");
    vad
      .enroll({ windows, minLevel, timeoutMs: 20000, onProgress: setProgress })
      .then((e) => {
        enrollmentRef.current = e;
        startSelfTest();
      })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStep("error");
      });
  }, [vad, windows, minLevel, startSelfTest]);

  const confirm = useCallback(() => {
    cleanupSelfTest();
    if (enrollmentRef.current) onComplete(enrollmentRef.current);
  }, [cleanupSelfTest, onComplete]);

  const redo = useCallback(() => {
    cleanupSelfTest();
    setStep("intro");
  }, [cleanupSelfTest]);

  useEffect(() => cleanupSelfTest, [cleanupSelfTest]);

  const levelPct = (lvl: number) => Math.round(Math.min(1, lvl * 6) * 100); // mic RMS is small; scale up
  const collectedPct = progress ? Math.round((progress.collected / progress.target) * 100) : 0;

  return (
    <div style={card}>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 4px" }}>Set up your voice</h2>

      {step === "intro" && (
        <>
          <p style={hint}>
            Ed will learn your voice so it only responds to you — not other people, a TV, or background
            chatter. We&apos;ll show you a short passage to read aloud (about 10 seconds). One time only.
          </p>
          <div style={row}>
            <button style={btn("#16a34a")} onClick={startCapture}>Start</button>
            {onCancel && <button style={btn("#374151")} onClick={onCancel}>Cancel</button>}
          </div>
        </>
      )}

      {step === "recording" && (
        <>
          <p style={{ ...hint, margin: "0 0 8px" }}>Read this aloud, at a natural pace:</p>
          <blockquote style={passage}>{SAMPLE_PASSAGE}</blockquote>
          <p style={{ ...hint, fontSize: 12, margin: "0 0 12px" }}>
            (Any speech works — it&apos;s your <i>voice</i> we&apos;re learning, not the words. Keep going until the bar fills.)
          </p>
          <Bar label="Mic level" pct={progress ? levelPct(progress.level) : 0}
               color={progress?.voiced ? "#38bdf8" : "#6b7280"} />
          <Bar label={`Captured ${progress?.collected ?? 0} / ${progress?.target ?? windows}`}
               pct={collectedPct} color="#16a34a" />
          {progress && !progress.voiced && progress.collected === 0 && (
            <p style={{ ...hint, color: "#fca5a5" }}>Too quiet — speak up or move closer to the mic.</p>
          )}
        </>
      )}

      {step === "verify" && (
        <>
          <p style={hint}>
            Got it. Now say something — it should light up <b style={{ color: "#4ade80" }}>green</b> for you.
          </p>
          <Bar label="Gate" pct={Math.round((selfTest?.gain ?? 0) * 100)}
               color={selfTest?.open ? "#4ade80" : "#6b7280"} />
          <div style={{ fontSize: 13, color: selfTest?.open ? "#4ade80" : "#9aa", marginBottom: 12 }}>
            {selfTest?.open ? "Hearing you ✓" : "…"}
          </div>
          <div style={row}>
            <button style={btn("#16a34a")} onClick={confirm}>Looks good</button>
            <button style={btn("#7c2d12")} onClick={redo}>Redo</button>
          </div>
        </>
      )}

      {step === "error" && (
        <>
          <p style={{ ...hint, color: "#fca5a5" }}>⚠ Enrollment didn’t catch enough speech: {errorMsg}</p>
          <div style={row}>
            <button style={btn("#16a34a")} onClick={startCapture}>Try again</button>
            {onCancel && <button style={btn("#374151")} onClick={onCancel}>Cancel</button>}
          </div>
        </>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #334", borderRadius: 12, padding: 16, background: "#0f1320", color: "#e7e7e7",
};
const hint: React.CSSProperties = { color: "#9aa", fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 };
const passage: React.CSSProperties = {
  margin: "0 0 8px", padding: "12px 14px", borderLeft: "3px solid #38bdf8", borderRadius: 6,
  background: "#111827", color: "#e7e7e7", fontSize: 16, lineHeight: 1.55, fontWeight: 500,
};
const row: React.CSSProperties = { display: "flex", gap: 8 };

function btn(bg: string): React.CSSProperties {
  return { padding: "8px 16px", borderRadius: 8, border: "none", background: bg, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" };
}

function Bar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "#9aa", marginBottom: 3 }}>{label}</div>
      <div style={{ height: 10, background: "#1f2430", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: "width 80ms linear" }} />
      </div>
    </div>
  );
}
