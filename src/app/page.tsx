"use client";

import { useCallback, useEffect, useState } from "react";
import VoiceAgent from "@/components/VoiceAgent";

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-amber-500/60">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

export default function Home() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState("");
  const [showKeyScreen, setShowKeyScreen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Load key from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem("openai-api-key");
    if (stored) setApiKey(stored);
    setHydrated(true);
  }, []);

  const saveKey = useCallback(() => {
    const trimmed = inputKey.trim();
    if (!trimmed) return;
    sessionStorage.setItem("openai-api-key", trimmed);
    setApiKey(trimmed);
    setShowKeyScreen(false);
    setInputKey("");
  }, [inputKey]);

  const clearKey = useCallback(() => {
    sessionStorage.removeItem("openai-api-key");
    setApiKey(null);
    setShowKeyScreen(false);
    setInputKey("");
  }, []);

  // Don't render until hydrated to avoid flash
  if (!hydrated) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center p-4">
        <div className="w-7 h-7 rounded-full border-2 border-white/20 border-t-amber-500/70" style={{ animation: "spin 0.8s linear infinite" }} />
      </main>
    );
  }

  // Show key input screen
  if (!apiKey || showKeyScreen) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3">
            <KeyIcon />
            <h1
              className="text-4xl font-black tracking-tight leading-none"
              style={{ fontFamily: "var(--font-syne)", color: "#f59e0b" }}
            >
              Ed
            </h1>
            <p className="text-white/40 text-sm text-center">
              Connect your OpenAI key to start
            </p>
          </div>

          <div className="w-full flex flex-col gap-3">
            <input
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveKey()}
              placeholder="Paste your OpenAI API key"
              autoFocus
              className="w-full rounded-xl px-4 py-3.5 text-sm text-white placeholder-white/25 outline-none transition-all duration-200 focus:ring-2 focus:ring-amber-500/40"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            />
            <button
              onClick={saveKey}
              disabled={!inputKey.trim()}
              className="w-full rounded-xl px-4 py-3.5 text-sm font-semibold tracking-wide uppercase transition-all duration-200 active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: "rgba(245,158,11,0.15)",
                border: "1px solid rgba(245,158,11,0.3)",
                color: "#f59e0b",
              }}
            >
              Connect
            </button>
          </div>

          <p className="text-white/20 text-xs text-center leading-relaxed max-w-xs">
            Your key stays in this browser tab and is never stored on our servers
          </p>

          {apiKey && showKeyScreen && (
            <button
              onClick={() => setShowKeyScreen(false)}
              className="text-white/30 text-xs tracking-widest uppercase active:text-white/60 transition-colors"
              style={{ minHeight: 44, padding: "0 24px" }}
            >
              Cancel
            </button>
          )}
        </div>
      </main>
    );
  }

  // Main conversation UI
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-between p-4">
      {/* Gear icon to change key */}
      <button
        onClick={() => setShowKeyScreen(true)}
        aria-label="Change API key"
        className="absolute top-4 right-4 z-20 rounded-full p-2.5 text-white/20 hover:text-white/50 active:text-white/70 transition-colors"
        style={{
          background: "rgba(255,255,255,0.04)",
          top: "max(env(safe-area-inset-top, 0px), 16px)",
          right: "max(env(safe-area-inset-right, 0px), 16px)",
        }}
      >
        <GearIcon />
      </button>
      <VoiceAgent apiKey={apiKey} onClearKey={clearKey} />
    </main>
  );
}
