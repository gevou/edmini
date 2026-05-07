"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import EventLogPanel from "@/components/EventLogPanel";
import { pushEvent } from "@/lib/event-log-store";
import type { SseEnvelope, SupervisorResponse } from "@/supervisor";

interface Turn {
  id: number;
  userText: string | null;
  edText: string;
  edStreaming: boolean;
}

type AgentStatus = "idle" | "connecting" | "listening" | "speaking" | "error";

const STORAGE_KEY = "ed_openai_key";

/**
 * Read an SSE response stream from /api/intent/classify, push every
 * supervisor `event` envelope into the EventLogPanel store, and resolve with
 * the final `result` envelope.
 *
 * The route always closes the stream; if it ends without a result, this
 * resolves with null and the caller treats it as a soft failure.
 */
async function readSupervisorStream(
  res: Response,
): Promise<SupervisorResponse | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: SupervisorResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by blank lines (\n\n)
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const envelope = JSON.parse(line.slice(6)) as SseEnvelope;
        if (envelope.type === "event") {
          pushEvent({
            kind: envelope.event.kind,
            label: envelope.event.label,
            detail: envelope.event.detail,
            payload: envelope.event.payload,
          });
        } else if (envelope.type === "result") {
          result = envelope.result as SupervisorResponse;
        } else if (envelope.type === "error") {
          pushEvent({
            kind: "error",
            label: "Supervisor error",
            detail: envelope.error,
          });
        }
      } catch {
        // Skip malformed envelope; the supervisor is expected to recover.
      }
    }
  }
  return result;
}

function MicIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5 10a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" />
      <path d="M12 17v4M9 21h6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function WaveBars({ color }: { color: string }) {
  return (
    <div className="flex items-center gap-[3px]" style={{ height: 28 }} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="w-[3px] rounded-full"
          style={{
            backgroundColor: color,
            height: "100%",
            animation: `wavebar 0.7s ease-in-out infinite`,
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <div
      className="w-7 h-7 rounded-full border-2 border-white/20 border-t-white/70"
      style={{ animation: "spin 0.8s linear infinite" }}
      aria-hidden="true"
    />
  );
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Tap to start a conversation",
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Ed is speaking",
  error: "Something went wrong — tap to retry",
};

function KeyInput({ onSave }: { onSave: (key: string) => void }) {
  const [value, setValue] = useState("");
  const accentColor = "#f59e0b";

  return (
    <div
      className="flex flex-col w-full max-w-lg mx-auto"
      style={{
        height: "100dvh",
        overflow: "hidden",
        touchAction: "none",
        overscrollBehavior: "none",
        paddingTop: "max(env(safe-area-inset-top), 20px)",
        paddingBottom: "max(env(safe-area-inset-bottom), 24px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      <header className="px-6 pt-4 pb-2 shrink-0">
        <h1
          className="text-5xl font-black tracking-tight leading-none"
          style={{ fontFamily: "var(--font-syne)", color: accentColor }}
        >
          Ed
        </h1>
        <p className="text-xs text-white/30 mt-1 tracking-widest uppercase">
          voice agent
        </p>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
        <div className="text-center">
          <p className="text-white/50 text-sm">Enter your OpenAI API key to get started</p>
          <p className="text-white/25 text-xs mt-1">Stored in session only — never sent to our servers</p>
        </div>

        <div className="w-full max-w-sm flex flex-col gap-3">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onSave(value.trim()); }}
            placeholder="sk-…"
            autoComplete="off"
            className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.8)",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(245,158,11,0.4)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; }}
          />
          <button
            onClick={() => { if (value.trim()) onSave(value.trim()); }}
            disabled={!value.trim()}
            className="w-full rounded-xl py-3 text-sm font-medium tracking-wider uppercase transition-all active:scale-95 disabled:opacity-30"
            style={{
              background: "rgba(245,158,11,0.12)",
              border: "1px solid rgba(245,158,11,0.28)",
              color: accentColor,
            }}
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VoiceAgent() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const pendingUserTextRef = useRef<string | null>(null);
  const pendingEdTextRef = useRef<string | null>(null);
  const turnCounterRef = useRef(0);
  const currentTurnIdRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const modelSpeakingFlagRef = useRef<boolean>(false);

  const sendToolResult = useCallback((callId: string, outputJson: string) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: outputJson,
        },
      }),
    );
    dc.send(JSON.stringify({ type: "response.create" }));
  }, []);

  const dispatchToolCall = useCallback(
    async (callId: string, name: string, args: Record<string, unknown>) => {
      if (name === "classify_and_route") {
        pushEvent({
          kind: "info",
          label: "Tool call: classify_and_route",
          detail:
            typeof args.transcript === "string"
              ? args.transcript
              : "(no transcript)",
        });
        try {
          const res = await fetch("/api/intent/classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcript: args.transcript ?? "",
              sessionId: sessionIdRef.current ?? "anonymous",
              context: args.context
                ? { metadata: { hint: args.context } }
                : undefined,
            }),
          });
          const result = await readSupervisorStream(res);
          sendToolResult(
            callId,
            JSON.stringify(
              result ?? { error: "supervisor returned no result" },
            ),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          pushEvent({ kind: "error", label: "Tool fetch failed", detail: message });
          sendToolResult(callId, JSON.stringify({ error: message }));
        }
        return;
      }

      if (name === "cancel_pending_action") {
        pushEvent({
          kind: "info",
          label: "Tool call: cancel_pending_action",
          payload: args,
        });
        // Noop — would route to /api/intent/cancel once implemented.
        pushEvent({
          kind: "cancelled",
          label: `Cancelled: ${(args.actionId as string) ?? "(unknown)"}`,
          detail:
            typeof args.reason === "string" ? args.reason : "no reason given",
        });
        sendToolResult(
          callId,
          JSON.stringify({
            acknowledged: true,
            actionId: args.actionId,
            reason: args.reason,
          }),
        );
        return;
      }

      pushEvent({
        kind: "error",
        label: `Unknown tool call: ${name}`,
        payload: args,
      });
      sendToolResult(callId, JSON.stringify({ error: `unknown tool ${name}` }));
    },
    [sendToolResult],
  );

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setApiKey(stored);
  }, []);

  const saveKey = useCallback((key: string) => {
    localStorage.setItem(STORAGE_KEY, key);
    setApiKey(key);
  }, []);

  const clearKey = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey(null);
    setStatus("idle");
    setTurns([]);
    setErrorMsg(null);
    currentTurnIdRef.current = null;
    turnCounterRef.current = 0;
  }, []);

  const scrollToBottom = useCallback(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  const postTurnToThread = useCallback(async (userText: string, edText: string) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["x-openai-key"] = apiKey;

      const res = await fetch("/api/threads/classify", {
        method: "POST",
        headers,
        body: JSON.stringify({ utterance: userText }),
      });
      if (!res.ok) return;
      const { threadId } = await res.json() as { threadId: string };
      if (threadId === "general") return;
      await Promise.all([
        fetch(`/api/threads/${threadId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: userText }),
        }),
        fetch(`/api/threads/${threadId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "ed", content: edText }),
        }),
      ]);
    } catch {
      // background — swallow errors silently
    }
  }, [apiKey]);

  useEffect(() => {
    scrollToBottom();
  }, [turns, scrollToBottom]);

  const handleDataChannelMessage = useCallback((event: MessageEvent) => {
    let serverEvent: Record<string, unknown>;
    try {
      serverEvent = JSON.parse(event.data as string);
    } catch {
      return;
    }

    const type = serverEvent.type as string;

    if (type === "input_audio_buffer.speech_started") {
      setStatus("listening");
      pushEvent({ kind: "user_spoke", label: "User started speaking" });
    }
    if (type === "input_audio_buffer.speech_stopped") {
      pushEvent({ kind: "user_paused", label: "User paused" });
    }
    if (type === "response.audio.delta") {
      setStatus("speaking");
      if (!modelSpeakingFlagRef.current) {
        modelSpeakingFlagRef.current = true;
        pushEvent({ kind: "model_speaking", label: "Model started speaking" });
      }
    }
    if (type === "response.done") {
      setStatus("listening");
      modelSpeakingFlagRef.current = false;
    }

    // Tool call from the voice model — route to the supervisor via SSE
    if (type === "response.function_call_arguments.done") {
      const callId = serverEvent.call_id as string;
      const name = serverEvent.name as string;
      const argsRaw = serverEvent.arguments as string;
      let args: Record<string, unknown> = {};
      try {
        args = argsRaw ? (JSON.parse(argsRaw) as Record<string, unknown>) : {};
      } catch {
        // fall through with empty args; supervisor will surface the error
      }
      // Fire-and-forget; do not block the data channel.
      void dispatchToolCall(callId, name, args);
    }

    // Ed streaming — create or append to current turn
    if (type === "response.audio_transcript.delta" || type === "response.text.delta") {
      const delta = serverEvent.delta as string;
      if (delta) {
        if (currentTurnIdRef.current !== null) {
          const activeId = currentTurnIdRef.current;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === activeId ? { ...t, edText: t.edText + delta } : t
            )
          );
        } else {
          const newId = ++turnCounterRef.current;
          currentTurnIdRef.current = newId;
          setTurns((prev) => [
            ...prev,
            { id: newId, userText: null, edText: delta, edStreaming: true },
          ]);
        }
      }
    }

    // Ed transcript finalized
    if (type === "response.audio_transcript.done" || type === "response.text.done") {
      const transcript = serverEvent.transcript as string | undefined;
      const activeId = currentTurnIdRef.current;
      currentTurnIdRef.current = null;
      if (activeId !== null) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === activeId
              ? { ...t, edText: transcript ?? t.edText, edStreaming: false }
              : t
          )
        );
      }
      if (type === "response.audio_transcript.done" && transcript) {
        const userText = pendingUserTextRef.current;
        if (userText) {
          pendingUserTextRef.current = null;
          pendingEdTextRef.current = null;
          postTurnToThread(userText, transcript);
        } else {
          pendingEdTextRef.current = transcript;
        }
      }
    }

    // User transcript — always arrives after Ed's response; backfill into most recent unmatched turn
    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = serverEvent.transcript as string;
      if (transcript?.trim()) {
        const text = transcript.trim();
        pushEvent({ kind: "user_spoke", label: "User transcript", detail: text });
        setTurns((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].userText === null) {
              return prev.map((t, idx) =>
                idx === i ? { ...t, userText: text } : t
              );
            }
          }
          // No unmatched turn — create standalone user turn
          const newId = ++turnCounterRef.current;
          return [...prev, { id: newId, userText: text, edText: "", edStreaming: false }];
        });
        const edText = pendingEdTextRef.current;
        if (edText) {
          pendingUserTextRef.current = null;
          pendingEdTextRef.current = null;
          postTurnToThread(text, edText);
        } else {
          pendingUserTextRef.current = text;
        }
      }
    }
  }, [postTurnToThread, dispatchToolCall]);

  const startSession = useCallback(async () => {
    setErrorMsg(null);
    setStatus("connecting");

    const newSessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `sess_${crypto.randomUUID()}`
        : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessionIdRef.current = newSessionId;
    pushEvent({
      kind: "session_started",
      label: "Voice session started",
      detail: newSessionId,
    });

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["x-openai-key"] = apiKey;

      const sessionRes = await fetch("/api/session", { method: "POST", headers });
      if (!sessionRes.ok) {
        const err = await sessionRes.json();
        throw new Error(err.error ?? "Failed to create session");
      }
      const sessionData = await sessionRes.json();
      const ephemeralKey: string = sessionData.client_secret?.value ?? sessionData.client_secret;
      if (!ephemeralKey) throw new Error("No ephemeral key returned");

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = new Audio();
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = handleDataChannelMessage;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${ephemeralKey}`, "Content-Type": "application/sdp" },
          body: offer.sdp,
        }
      );

      if (!sdpRes.ok) throw new Error(`SDP exchange failed: ${await sdpRes.text()}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

      setStatus("listening");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
      stopSession();
    }
  }, [handleDataChannelMessage, apiKey]);

  const stopSession = useCallback(() => {
    const activeId = currentTurnIdRef.current;
    currentTurnIdRef.current = null;
    if (activeId !== null) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === activeId ? { ...t, edStreaming: false } : t
        )
      );
    }
    dcRef.current?.close();
    pcRef.current?.close();
    dcRef.current = null;
    pcRef.current = null;
    if (audioElRef.current) audioElRef.current.srcObject = null;
    modelSpeakingFlagRef.current = false;
    if (sessionIdRef.current) {
      pushEvent({
        kind: "session_ended",
        label: "Voice session ended",
        detail: sessionIdRef.current,
      });
      sessionIdRef.current = null;
    }
    setStatus("idle");
  }, []);

  const toggleSession = useCallback(() => {
    if (status === "idle" || status === "error") startSession();
    else stopSession();
  }, [status, startSession, stopSession]);

  if (!apiKey) {
    return (
      <>
        <KeyInput onSave={saveKey} />
        <EventLogPanel />
      </>
    );
  }

  const isActive = status === "listening" || status === "speaking" || status === "connecting";
  const accentColor = status === "speaking" ? "#a78bfa" : status === "error" ? "#f87171" : "#f59e0b";

  const buttonIcon =
    status === "connecting" ? <Spinner /> :
    status === "speaking" ? <WaveBars color={accentColor} /> :
    <MicIcon />;

  const bgColor = "#0e0a04";

  return (
    <>
    <div
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        maxWidth: 512,
        margin: "0 auto",
        overflow: "hidden",
        touchAction: "none",
        overscrollBehavior: "none",
      }}
    >
      {/* Fixed header */}
      <header
        className="shrink-0 flex items-start justify-between"
        style={{
          padding: "max(env(safe-area-inset-top), 20px) 24px 8px",
          background: bgColor,
          zIndex: 10,
        }}
      >
        <div>
          <h1
            className="text-5xl font-black tracking-tight leading-none"
            style={{ fontFamily: "var(--font-syne)", color: accentColor, transition: "color 0.4s ease" }}
          >
            Ed
          </h1>
          <p className="text-xs text-white/30 mt-1 tracking-widest uppercase">
            voice agent
          </p>
        </div>
        <button
          onClick={clearKey}
          title="Change API key"
          className="mt-1 text-white/20 text-xs tracking-widest uppercase hover:text-white/40 transition-colors"
          style={{ minHeight: 36, padding: "0 4px" }}
        >
          key
        </button>
      </header>

      {/* Scrollable transcript — only this area scrolls */}
      <div
        ref={transcriptRef}
        className="flex-1 overflow-y-auto"
        style={{
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
          overscrollBehaviorY: "contain",
          touchAction: "pan-y",
          // Top/sides padding as before; bottom padding is generous so users
          // can scroll the latest bubble well above the floating mic button.
          padding:
            "12px 16px calc(260px + env(safe-area-inset-bottom, 0px)) 16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {turns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
            <div className="w-px h-12 bg-gradient-to-b from-transparent via-white/10 to-transparent" />
            <p className="text-white/20 text-sm text-center">
              Conversation will appear here
            </p>
            <div className="w-px h-12 bg-gradient-to-b from-transparent via-white/10 to-transparent" />
          </div>
        ) : (
          turns.map((turn) => (
            <Fragment key={turn.id}>
              {/* User bubble — always first, placeholder until transcript arrives */}
              <div className="flex justify-end">
                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed rounded-br-sm text-white ${turn.userText === null ? "opacity-40" : ""}`}
                  style={{ background: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.25)" }}
                >
                  {turn.userText ?? "…"}
                </div>
              </div>
              {/* Ed bubble — always second */}
              {(turn.edText || turn.edStreaming) && (
                <div className="flex justify-start">
                  <div
                    className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed rounded-bl-sm text-white/90 ${turn.edStreaming ? "opacity-60" : ""}`}
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    {turn.edText}
                    {turn.edStreaming && (
                      <span className="inline-block w-1 h-3 ml-1 bg-current rounded-full align-middle" style={{ animation: "pulse 1s ease-in-out infinite" }} />
                    )}
                  </div>
                </div>
              )}
            </Fragment>
          ))
        )}
      </div>

      {/* Floating button area — overlays the transcript so content can scroll
           up past it. Container is fully transparent and pointer-events:none
           so it doesn't block taps; only the actual button + status text
           re-enable pointer-events. */}
      <div
        className="fixed flex flex-col items-center gap-3 pointer-events-none"
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          bottom: 0,
          width: "100%",
          maxWidth: 512,
          padding:
            "60px 24px calc(20px + env(safe-area-inset-bottom, 0px))",
          // Subtle bottom-anchored gradient so transcript text doesn't read
          // through hard-edged behind the button. Background is mostly
          // transparent — visually it should feel like the mic floats.
          background:
            "linear-gradient(to bottom, transparent 0%, rgba(14,10,4,0.20) 40%, rgba(14,10,4,0.55) 75%, rgba(14,10,4,0.75) 100%)",
          zIndex: 10,
        }}
      >
        {errorMsg && (
          <p className="text-red-400/80 text-xs text-center max-w-xs">{errorMsg}</p>
        )}

        {/* Button with pulse rings */}
        <div className="relative flex items-center justify-center pointer-events-auto">
          {(status === "listening" || status === "speaking") && (
            <span
              className="absolute rounded-full"
              style={{
                width: 144,
                height: 144,
                background: accentColor,
                opacity: 0.07,
                animation: "ring-expand 2s ease-out infinite",
              }}
            />
          )}
          {(status === "listening" || status === "speaking") && (
            <span
              className="absolute rounded-full"
              style={{
                width: 120,
                height: 120,
                background: accentColor,
                opacity: 0.12,
                animation: "ring-expand 2s ease-out infinite 0.6s",
              }}
            />
          )}

          <button
            onClick={toggleSession}
            disabled={status === "connecting"}
            aria-label={isActive ? "End conversation" : "Start conversation with Ed"}
            className="relative z-10 rounded-full flex items-center justify-center transition-all duration-300 active:scale-95"
            style={{
              width: 88,
              height: 88,
              background: isActive
                ? `rgba(${status === "speaking" ? "167,139,250" : "245,158,11"}, 0.12)`
                : "rgba(255,255,255,0.06)",
              border: `2px solid ${isActive ? accentColor : "rgba(255,255,255,0.15)"}`,
              boxShadow: isActive ? `0 0 32px ${accentColor}33, 0 0 8px ${accentColor}22` : "none",
              color: isActive ? accentColor : "rgba(255,255,255,0.5)",
              transition: "all 0.3s ease",
            }}
          >
            {isActive && status !== "connecting" ? (
              <div className="flex flex-col items-center gap-1">
                {buttonIcon}
              </div>
            ) : (
              buttonIcon
            )}
          </button>
        </div>

        {isActive && status !== "connecting" && (
          <button
            onClick={stopSession}
            className="text-white/30 text-xs tracking-widest uppercase active:text-white/60 transition-colors pointer-events-auto"
            style={{ minHeight: 44, padding: "0 24px" }}
          >
            End
          </button>
        )}

        {!isActive && (
          <p
            className="text-white/30 text-xs tracking-wide"
            style={{ minHeight: 44, display: "flex", alignItems: "center" }}
          >
            {STATUS_LABEL[status]}
          </p>
        )}

        {status === "listening" && (
          <p className="text-xs tracking-widest uppercase" style={{ color: accentColor, minHeight: 20 }}>
            Listening
          </p>
        )}
        {status === "speaking" && (
          <p className="text-xs tracking-widest uppercase" style={{ color: accentColor, minHeight: 20 }}>
            Ed is speaking
          </p>
        )}
        {status === "connecting" && (
          <p className="text-white/40 text-xs tracking-widest uppercase" style={{ minHeight: 20 }}>
            Connecting…
          </p>
        )}
      </div>
    </div>
    <EventLogPanel />
    </>
  );
}
