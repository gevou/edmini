"use client";

/**
 * Target-speaker VAD lab (edmini-xz9) — a STANDALONE harness to exercise the TS-VAD feature without
 * edmini's voice loop. Enroll your voice, watch the live target-speaker score and gate, and monitor
 * the gated output (use headphones — monitoring the mic out loud will feed back).
 *
 * This is where the on-device validation from the issue's acceptance criteria happens: drop the CAM++
 * ONNX at the model URL, then check that (1) it runs within latency budget, (2) your voice scores high
 * while another English speaker scores low, and (3) the gate doesn't clip your sentence onsets.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createBrowserTargetSpeakerVad,
  type ScoreEvent,
  type TargetSpeakerVad,
} from "@/lib/tsvad";

type Phase = "idle" | "loading" | "running" | "enrolling" | "error";

const DEFAULT_MODEL_URL = "/models/campplus.onnx";

export default function TsvadLabPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [modelUrl, setModelUrl] = useState(DEFAULT_MODEL_URL);
  const [error, setError] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [score, setScore] = useState<ScoreEvent | null>(null);
  const [monitor, setMonitor] = useState(false);

  const vadRef = useRef<TargetSpeakerVad | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setPhase("loading");
    try {
      const vad = await createBrowserTargetSpeakerVad({ modelUrl });
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;
      await vad.start(mic);
      vad.onScore((e) => setScore(e));
      vadRef.current = vad;
      setEnrolled(vad.isEnrolled());
      setPhase("running");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [modelUrl]);

  const enroll = useCallback(async () => {
    const vad = vadRef.current;
    if (!vad) return;
    setPhase("enrolling");
    setError(null);
    try {
      await vad.enroll({ windows: 12 });
      setEnrolled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase("running");
    }
  }, []);

  const clearEnrollment = useCallback(() => {
    try {
      localStorage.removeItem("tsvad_enrollment");
    } catch {
      /* ignore */
    }
    vadRef.current?.setEnrollment(null);
    setEnrolled(false);
  }, []);

  const stop = useCallback(async () => {
    await vadRef.current?.stop();
    vadRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    setPhase("idle");
    setScore(null);
  }, []);

  // Route the gated output to the <audio> element when monitoring is on.
  useEffect(() => {
    const el = audioRef.current;
    const stream = vadRef.current?.getProcessedStream() ?? null;
    if (!el) return;
    el.srcObject = monitor ? stream : null;
    if (monitor) void el.play().catch(() => {});
  }, [monitor, phase]);

  useEffect(() => () => void vadRef.current?.stop(), []);

  const pct = (x: number) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;
  // Map cosine [-1,1] → [0,1] for the meter.
  const norm = (x: number) => (x + 1) / 2;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#e7e7e7" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Target-Speaker VAD — Lab</h1>
      <p style={{ color: "#9aa", fontSize: 13, marginBottom: 20 }}>
        Standalone harness for edmini-xz9. Enroll your voice, then watch the gate. Use headphones if you
        enable monitoring.
      </p>

      <label style={{ display: "block", fontSize: 12, color: "#9aa", marginBottom: 4 }}>CAM++ ONNX model URL</label>
      <input
        value={modelUrl}
        onChange={(e) => setModelUrl(e.target.value)}
        disabled={phase !== "idle" && phase !== "error"}
        style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #334", background: "#111", color: "#ddd", marginBottom: 16, fontSize: 13 }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {phase === "idle" || phase === "error" ? (
          <button onClick={start} style={btn("#2563eb")}>Start</button>
        ) : (
          <button onClick={stop} style={btn("#374151")}>Stop</button>
        )}
        <button
          onClick={enroll}
          disabled={phase !== "running"}
          style={btn(phase === "running" ? "#16a34a" : "#1f2937")}
        >
          {phase === "enrolling" ? "Enrolling…" : enrolled ? "Re-enroll" : "Enroll my voice"}
        </button>
        {enrolled && <button onClick={clearEnrollment} style={btn("#7f1d1d")}>Clear enrollment</button>}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#9aa" }}>
          <input type="checkbox" checked={monitor} onChange={(e) => setMonitor(e.target.checked)} disabled={phase !== "running"} />
          Monitor gated output
        </label>
      </div>

      <div style={{ fontSize: 12, color: "#9aa", marginBottom: 8 }}>
        Status: <b style={{ color: "#ddd" }}>{phase}</b>
        {" · "}target: <b style={{ color: enrolled ? "#4ade80" : "#fca5a5" }}>{enrolled ? "enrolled" : "none (pass-through)"}</b>
      </div>

      {error && <p style={{ color: "#fca5a5", fontSize: 13, marginBottom: 12 }}>⚠ {error}</p>}

      {/* Meters */}
      <Meter label="Target score (raw)" value={score?.raw != null ? norm(score.raw) : 0} color="#38bdf8" text={score?.raw != null ? score.raw.toFixed(3) : "—"} />
      <Meter label="Smoothed score" value={norm(score?.smoothedScore ?? -1)} color="#818cf8" text={(score?.smoothedScore ?? 0).toFixed(3)} />
      <Meter label="Gate gain" value={score?.gain ?? 0} color={score?.open ? "#4ade80" : "#6b7280"} text={pct(score?.gain ?? 0)} />

      <div style={{ marginTop: 12, fontSize: 13, color: score?.open ? "#4ade80" : "#9aa" }}>
        Gate: <b>{score?.open ? "OPEN — passing your voice" : "closed — muted"}</b>
      </div>

      <audio ref={audioRef} hidden />

      <p style={{ marginTop: 24, fontSize: 11, color: "#667" }}>
        No CAM++ model yet? Convert/download the 3D-Speaker CAM++ ONNX
        (iic/speech_campplus_sv_zh-cn_16k-common, Apache-2.0) and serve it at the URL above
        (e.g. public/models/campplus.onnx).
      </p>
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return { padding: "8px 14px", borderRadius: 8, border: "none", background: bg, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" };
}

function Meter({ label, value, color, text }: { label: string; value: number; color: string; text: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9aa", marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums", color: "#ddd" }}>{text}</span>
      </div>
      <div style={{ height: 10, background: "#1f2430", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: color, transition: "width 80ms linear" }} />
      </div>
    </div>
  );
}
