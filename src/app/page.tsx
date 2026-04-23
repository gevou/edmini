"use client";

import { useEffect, useRef, useState } from "react";

type AgentState = "idle" | "connecting" | "listening" | "speaking" | "error";

export default function Home() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("ed-api-key");
    if (stored) setApiKey(stored);
  }, []);

  function saveKey(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    sessionStorage.setItem("ed-api-key", trimmed);
    setApiKey(trimmed);
    setKeyInput("");
    setShowKeyInput(false);
  }

  async function startSession() {
    if (!apiKey) return;
    setAgentState("connecting");
    setErrorMsg("");

    try {
      const tokenRes = await fetch("/api/session", {
        method: "POST",
        headers: {
          "x-openai-key": apiKey,
        },
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        throw new Error(err.error || "Failed to create session");
      }

      const { client_secret } = await tokenRes.json();
      const ephemeralKey = client_secret.value;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = new Audio();
      audio.autoplay = true;
      audioRef.current = audio;

      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pc.addTrack(stream.getTracks()[0]);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        setAgentState("listening");
        dc.send(
          JSON.stringify({
            type: "session.update",
            session: {
              instructions:
                "You are Ed, a friendly and natural conversational AI. Keep responses concise and conversational.",
              turn_detection: { type: "server_vad" },
            },
          })
        );
      };

      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === "response.audio.delta") {
            setAgentState("speaking");
          } else if (
            event.type === "response.done" ||
            event.type === "input_audio_buffer.speech_started"
          ) {
            setAgentState("listening");
          }
        } catch {
          // ignore parse errors
        }
      };

      dc.onerror = () => setAgentState("error");
      dc.onclose = () => setAgentState("idle");

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
        throw new Error("Failed to connect to OpenAI Realtime");
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (err) {
      setAgentState("error");
      setErrorMsg(err instanceof Error ? err.message : "Connection failed");
    }
  }

  function stopSession() {
    dcRef.current?.close();
    pcRef.current?.close();
    pcRef.current = null;
    dcRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    setAgentState("idle");
  }

  const isActive = agentState === "listening" || agentState === "speaking";

  if (!apiKey || showKeyInput) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-semibold text-amber-400">Ed Mini</h1>
            <p className="text-zinc-400 text-sm">Voice agent</p>
          </div>

          <form onSubmit={saveKey} className="space-y-4">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Paste your OpenAI API key"
              autoFocus
              className="w-full px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
            />
            <button
              type="submit"
              disabled={!keyInput.trim()}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-semibold transition"
            >
              Connect
            </button>
          </form>

          <p className="text-center text-zinc-600 text-xs">
            Your key stays in this browser tab only
          </p>

          {showKeyInput && (
            <button
              onClick={() => setShowKeyInput(false)}
              className="w-full text-zinc-500 text-sm hover:text-zinc-300 transition"
            >
              Cancel
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col">
      <header className="flex justify-end p-4">
        <button
          onClick={() => setShowKeyInput(true)}
          aria-label="Change API key"
          className="text-zinc-600 hover:text-amber-400 transition p-2 rounded-lg hover:bg-zinc-900"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-10 p-6">
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-semibold text-amber-400">Ed</h1>
          <p className="text-zinc-500 text-sm">
            {agentState === "idle" && "Ready"}
            {agentState === "connecting" && "Connecting…"}
            {agentState === "listening" && "Listening"}
            {agentState === "speaking" && "Speaking"}
            {agentState === "error" && (errorMsg || "Error")}
          </p>
        </div>

        <button
          onClick={isActive ? stopSession : startSession}
          disabled={agentState === "connecting"}
          className={`
            w-24 h-24 rounded-full font-semibold text-sm transition-all duration-200
            ${isActive
              ? "bg-red-600 hover:bg-red-500 text-white scale-105"
              : agentState === "connecting"
              ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
              : "bg-amber-500 hover:bg-amber-400 text-zinc-950"
            }
            ${agentState === "speaking" ? "ring-4 ring-amber-400 ring-opacity-50" : ""}
          `}
        >
          {isActive ? "Stop" : agentState === "connecting" ? "…" : "Talk"}
        </button>

        {agentState === "error" && (
          <p className="text-red-400 text-sm text-center max-w-xs">
            {errorMsg}
          </p>
        )}
      </div>
    </main>
  );
}
