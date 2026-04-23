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

export default function VoiceAgent() {
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

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

    if (type === "input_audio_buffer.speech_started") {
      setStatus("listening");
    }

    if (type === "input_audio_buffer.speech_stopped") {
      setStatus("listening");
    }

    if (type === "response.audio.delta") {
      setStatus("speaking");
    }

    if (type === "response.done") {
      setStatus("listening");
    }

    // User transcript (committed)
    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = serverEvent.transcript as string;
      if (transcript?.trim()) {
        const itemId = serverEvent.item_id as string;
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === itemId);
          if (existing) {
            return prev.map((m) =>
              m.id === itemId ? { ...m, text: transcript, final: true } : m
            );
          }
          return [...prev, { id: itemId, role: "user", text: transcript, final: true }];
        });
      }
    }

    // Assistant text delta (streaming)
    if (type === "response.text.delta") {
      const delta = serverEvent.delta as string;
      const itemId = serverEvent.item_id as string;
      if (delta && itemId) {
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === itemId);
          if (existing) {
            return prev.map((m) =>
              m.id === itemId ? { ...m, text: m.text + delta } : m
            );
          }
          return [...prev, { id: itemId, role: "assistant", text: delta, final: false }];
        });
      }
    }

    // Assistant text final
    if (type === "response.text.done") {
      const itemId = serverEvent.item_id as string;
      setMessages((prev) =>
        prev.map((m) => (m.id === itemId ? { ...m, final: true } : m))
      );
    }
  }, []);

  const startSession = useCallback(async () => {
    setErrorMsg(null);
    setStatus("connecting");

    try {
      // 1. Get ephemeral token
      const sessionRes = await fetch("/api/session", { method: "POST" });
      if (!sessionRes.ok) {
        const err = await sessionRes.json();
        throw new Error(err.error ?? "Failed to create session");
      }
      const sessionData = await sessionRes.json();
      const ephemeralKey: string = sessionData.client_secret?.value ?? sessionData.client_secret;
      if (!ephemeralKey) throw new Error("No ephemeral key returned");

      // 2. Set up RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Remote audio → hidden <audio> element
      const audioEl = new Audio();
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };

      // Local mic input
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // DataChannel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = handleDataChannelMessage;

      // 3. Create SDP offer and connect to OpenAI Realtime
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        }
      );

      if (!sdpRes.ok) {
        const txt = await sdpRes.text();
        throw new Error(`SDP exchange failed: ${txt}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setStatus("listening");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
      stopSession();
    }
  }, [handleDataChannelMessage]);

  const stopSession = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    dcRef.current = null;
    pcRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
    }
    setStatus("idle");
  }, []);

  const toggleSession = useCallback(() => {
    if (status === "idle" || status === "error") {
      startSession();
    } else {
      stopSession();
    }
  }, [status, startSession, stopSession]);

  const isActive = status === "listening" || status === "speaking" || status === "connecting";

  const statusLabel: Record<AgentStatus, string> = {
    idle: "Tap to start",
    connecting: "Connecting...",
    listening: "Listening",
    speaking: "Ed is speaking",
    error: "Error — tap to retry",
  };

  const buttonColor: Record<AgentStatus, string> = {
    idle: "bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700",
    connecting: "bg-gray-600 cursor-wait",
    listening: "bg-green-600 hover:bg-green-500 active:bg-green-700",
    speaking: "bg-purple-600 hover:bg-purple-500",
    error: "bg-red-600 hover:bg-red-500",
  };

  return (
    <div className="flex flex-col w-full max-w-lg mx-auto min-h-dvh py-8 gap-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Ed</h1>
        <p className="text-gray-400 text-sm mt-1">Voice Agent</p>
      </div>

      {/* Transcript */}
      <div
        ref={transcriptRef}
        className="flex-1 overflow-y-auto flex flex-col gap-3 px-1 min-h-0"
        style={{ maxHeight: "calc(100dvh - 280px)" }}
      >
        {messages.length === 0 && (
          <p className="text-center text-gray-600 text-sm mt-8">
            Conversation will appear here
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`rounded-2xl px-4 py-2.5 max-w-[80%] text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-sm"
                  : "bg-gray-800 text-gray-100 rounded-bl-sm"
              } ${!msg.final ? "opacity-70" : ""}`}
            >
              {msg.text}
              {!msg.final && (
                <span className="inline-block w-1 h-3 ml-1 bg-current animate-pulse rounded-full align-middle" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Status + Button */}
      <div className="flex flex-col items-center gap-4 pb-4">
        {errorMsg && (
          <p className="text-red-400 text-xs text-center px-4">{errorMsg}</p>
        )}

        <div className="relative">
          {/* Pulse ring when active */}
          {(status === "listening" || status === "speaking") && (
            <span className="absolute inset-0 rounded-full animate-ping opacity-20 bg-white" />
          )}
          <button
            onClick={toggleSession}
            disabled={status === "connecting"}
            className={`relative w-24 h-24 rounded-full text-white font-semibold text-sm transition-all duration-200 shadow-lg ${buttonColor[status]}`}
          >
            {isActive ? "End" : "Talk to Ed"}
          </button>
        </div>

        <p className="text-gray-400 text-sm">{statusLabel[status]}</p>
      </div>
    </div>
  );
}
