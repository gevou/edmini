"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  text: string;
  final: boolean;
}

type AgentStatus = "idle" | "connecting" | "listening" | "speaking" | "error";

const STORAGE_KEY = "ed_openai_key";

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
        minHeight: "100dvh",
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const pendingUserTextRef = useRef<string | null>(null);

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
    setMessages([]);
    setErrorMsg(null);
  }, []);

  const scrollToBottom = useCallback(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  const postTurnToThread = useCallback(async (userText: string, edText: string) => {
    try {
      const classifyHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) classifyHeaders["x-openai-key"] = apiKey;
      const res = await fetch("/api/threads/classify", {
        method: "POST",
        headers: classifyHeaders,
        body: JSON.stringify({ utterance: userText }),
      });
      if (!res.ok) return;
      const { threadId } = await res.json() as { threadId: string };
      if (!threadId || threadId === "general") return;
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
  }, [messages, scrollToBottom]);

  const handleDataChannelMessage = useCallback((event: MessageEvent) => {
    let serverEvent: Record<string, unknown>;
    try {
      serverEvent = JSON.parse(event.data as string);
    } catch {
      return;
    }

    const type = serverEvent.type as string;

    if (type === "input_audio_buffer.speech_started") setStatus("listening");
    if (type === "response.audio.delta") setStatus("speaking");
    if (type === "response.done") setStatus("listening");

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = serverEvent.transcript as string;
      if (transcript?.trim()) {
        pendingUserTextRef.current = transcript.trim();
        const itemId = serverEvent.item_id as string;
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === itemId);
          if (existing) return prev.map((m) => m.id === itemId ? { ...m, text: transcript, final: true } : m);
          const newMsg: Message = { id: itemId, role: "user", text: transcript, final: true };
          // Insert before any streaming (non-final) assistant message so user always precedes Ed's response
          const streamingIdx = prev.findIndex((m) => m.role === "assistant" && !m.final);
          if (streamingIdx !== -1) {
            const next = [...prev];
            next.splice(streamingIdx, 0, newMsg);
            return next;
          }
          return [...prev, newMsg];
        });
      }
    }

    if (type === "response.audio_transcript.delta" || type === "response.text.delta") {
      const delta = serverEvent.delta as string;
      const itemId = serverEvent.item_id as string;
      if (delta && itemId) {
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === itemId);
          if (existing) return prev.map((m) => m.id === itemId ? { ...m, text: m.text + delta } : m);
          return [...prev, { id: itemId, role: "assistant", text: delta, final: false }];
        });
      }
    }

    if (type === "response.audio_transcript.done" || type === "response.text.done") {
      const itemId = serverEvent.item_id as string;
      const transcript = serverEvent.transcript as string | undefined;
      setMessages((prev) => prev.map((m) =>
        m.id === itemId ? { ...m, text: transcript ?? m.text, final: true } : m
      ));
      if (type === "response.audio_transcript.done") {
        const edText = transcript;
        const userText = pendingUserTextRef.current;
        if (edText && userText) {
          pendingUserTextRef.current = null;
          postTurnToThread(userText, edText);
        }
      }
    }
  }, [postTurnToThread]);

  const startSession = useCallback(async () => {
    setErrorMsg(null);
    setStatus("connecting");

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
    dcRef.current?.close();
    pcRef.current?.close();
    dcRef.current = null;
    pcRef.current = null;
    if (audioElRef.current) audioElRef.current.srcObject = null;
    setStatus("idle");
  }, []);

  const toggleSession = useCallback(() => {
    if (status === "idle" || status === "error") startSession();
    else stopSession();
  }, [status, startSession, stopSession]);

  if (!apiKey) {
    return <KeyInput onSave={saveKey} />;
  }

  const isActive = status === "listening" || status === "speaking" || status === "connecting";
  const accentColor = status === "speaking" ? "#a78bfa" : status === "error" ? "#f87171" : "#f59e0b";

  const buttonIcon =
    status === "connecting" ? <Spinner /> :
    status === "speaking" ? <WaveBars color={accentColor} /> :
    <MicIcon />;

  return (
    <div
      className="fixed inset-0 flex flex-col w-full max-w-lg mx-auto"
      style={{
        paddingTop: "max(env(safe-area-inset-top), 20px)",
        paddingBottom: "max(env(safe-area-inset-bottom), 24px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      {/* Header */}
      <header className="px-6 pt-4 pb-2 shrink-0 flex items-start justify-between">
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

      {/* Transcript */}
      <div
        ref={transcriptRef}
        className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 overscroll-contain"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
            <div className="w-px h-12 bg-gradient-to-b from-transparent via-white/10 to-transparent" />
            <p className="text-white/20 text-sm text-center">
              Conversation will appear here
            </p>
            <div className="w-px h-12 bg-gradient-to-b from-transparent via-white/10 to-transparent" />
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`
                  max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed
                  ${msg.role === "user"
                    ? "rounded-br-sm text-white"
                    : "rounded-bl-sm text-white/90"}
                  ${!msg.final ? "opacity-60" : ""}
                `}
                style={
                  msg.role === "user"
                    ? { background: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.25)" }
                    : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }
                }
              >
                {msg.text}
                {!msg.final && (
                  <span className="inline-block w-1 h-3 ml-1 bg-current rounded-full align-middle" style={{ animation: "pulse 1s ease-in-out infinite" }} />
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Button area */}
      <div className="shrink-0 flex flex-col items-center gap-5 px-6 pt-4">
        {errorMsg && (
          <p className="text-red-400/80 text-xs text-center max-w-xs">{errorMsg}</p>
        )}

        {/* Button with pulse rings */}
        <div className="relative flex items-center justify-center">
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
            className="text-white/30 text-xs tracking-widest uppercase active:text-white/60 transition-colors"
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
  );
}
