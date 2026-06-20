"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import EventLogPanel from "@/components/EventLogPanel";
import { pushEvent } from "@/lib/event-log-store";
import type { LedgerEvent } from "@/lib/ledger";
import { ledgerFromEnv } from "@/lib/ledger-supabase";
import { createRunRegistry, type RunRegistry } from "@/lib/voice/run-registry";
import {
  createNarrationQueue,
  type NarrationBatch,
  type NarrationQueue,
  type Priority,
} from "@/lib/voice/narration-queue";
import { createNarrationProgress, type NarrationProgress } from "@/lib/voice/narration-progress";

/**
 * How each interpreted harness lifecycle event becomes a narration item (9ex). `render` produces the
 * bare content; the run's label is prepended when composing the spoken batch. blocked/failed are
 * high priority (need the user); output/done are low. Raw discord_message and outbound (edmini)
 * events are not narrated.
 */
const NARRATE: Record<string, { priority: Priority; render: (p: Record<string, unknown>) => string }> = {
  run_blocked: { priority: "high", render: (p) => `is asking — ${(p.question as string) ?? ""}` },
  run_failed: { priority: "high", render: (p) => `failed — ${(p.error as string) ?? ""}` },
  run_output: { priority: "low", render: (p) => `reported — ${(p.text as string) ?? ""}` },
  run_done: { priority: "low", render: (p) => `finished — ${(p.summary as string) ?? ""}` },
};

interface Turn {
  id: number;
  userText: string | null;
  edText: string;
  edStreaming: boolean;
  spokenIndex?: number; // conservative spoken-so-far cursor while Ed narrates this turn (mb0)
}

type AgentStatus = "idle" | "connecting" | "listening" | "speaking" | "error";

const STORAGE_KEY = "ed_openai_key";
// Surfaced in the header + logged on session start so it's unambiguous which bundle is running.
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "unknown";

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
  const ledgerChannelRef = useRef<RealtimeChannel | null>(null);
  // N concurrent runs (9ex): the registry maps label↔runId; the queue serialises narration onto the
  // single voice output channel under the priority policy. userSpeaking/responseActive gate draining
  // so we never interrupt the User and never fire response.create while a response is in flight.
  const runRegistryRef = useRef<RunRegistry | null>(null);
  if (!runRegistryRef.current) runRegistryRef.current = createRunRegistry();
  const narrationQueueRef = useRef<NarrationQueue | null>(null);
  if (!narrationQueueRef.current) narrationQueueRef.current = createNarrationQueue();
  const userSpeakingRef = useRef<boolean>(false);
  const responseActiveRef = useRef<boolean>(false);
  // Outgoing `response.create` must be serialised: the Realtime API allows only ONE response in
  // flight and rejects extras. Before serialising, two concurrent tool results both fired
  // response.create → the second was rejected with no matching response.done, so responseActiveRef
  // got stuck true and ALL narration went silent (edmini-9ex live-test failure). Tool results that
  // arrive while a response is active queue here and fire when the current one ends.
  const pendingToolResponsesRef = useRef<Array<() => void>>([]);
  // True while the next Ed turn is proactive narration (no user utterance), so its transcript turn
  // renders without a blank user bubble. Set when narration is injected; cleared when the User speaks.
  const edInitiatedPendingRef = useRef<boolean>(false);
  // Narration progress (mb0): a conservative spoken-position cursor for the active Ed turn.
  const narrationProgressRef = useRef<NarrationProgress | null>(null);
  if (!narrationProgressRef.current) narrationProgressRef.current = createNarrationProgress();
  const audioStartRef = useRef<number | null>(null); // audioEl.currentTime at this utterance's audio start
  const progressTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fire one response: send its conversation item(s), then response.create, marking a response in
  // flight. Only call when responseActiveRef is false.
  const fireResponse = useCallback((sendItems: () => void) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    responseActiveRef.current = true;
    sendItems();
    dc.send(JSON.stringify({ type: "response.create" }));
  }, []);

  const sendToolResult = useCallback(
    (callId: string, outputJson: string) => {
      const sendOutput = () =>
        dcRef.current?.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: callId, output: outputJson },
          }),
        );
      if (responseActiveRef.current) pendingToolResponsesRef.current.push(sendOutput);
      else fireResponse(sendOutput);
    },
    [fireResponse],
  );

  // Speak a batch of background updates as one utterance, each prefixed with its run label, framed so
  // the model relays rather than reads verbatim. Only invoked from tryDrain when the channel is idle.
  const injectNarration = useCallback(
    (batch: NarrationBatch) => {
      if (!dcRef.current || dcRef.current.readyState !== "open" || batch.length === 0) return;
      edInitiatedPendingRef.current = true; // this response is Ed-initiated (no user utterance)
      const lines = batch
        .map((i) => (i.label ? `Run '${i.label}' ${i.text}` : i.text))
        .join(". ");
      fireResponse(() =>
        dcRef.current?.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `(System update — relay to the User naturally and briefly, in your own words; name the task when more than one is in flight; do not read verbatim.) ${lines}`,
                },
              ],
            },
          }),
        ),
      );
    },
    [fireResponse],
  );

  // Drain the narration queue if the channel is idle (open, User not speaking, no response in
  // flight). Re-called whenever idle state may have changed: new enqueue, response end, user pause.
  const tryDrain = useCallback(() => {
    const dc = dcRef.current;
    const canSpeak =
      !!dc && dc.readyState === "open" && !userSpeakingRef.current && !responseActiveRef.current;
    const batch = narrationQueueRef.current!.drain(canSpeak);
    if (batch) injectNarration(batch);
  }, [injectNarration]);

  // A response finished OR was rejected (error). Clear the in-flight flag, then fire the next queued
  // tool-result response if any, else try a narration batch. This is what unsticks the channel.
  const onResponseEnded = useCallback(() => {
    responseActiveRef.current = false;
    const next = pendingToolResponsesRef.current.shift();
    if (next) fireResponse(next);
    else tryDrain();
  }, [fireResponse, tryDrain]);

  // An interpreted harness event for one of our runs → enqueue a narration item (by label).
  // run_done/run_failed close the run out of the registry; everything else updates its status.
  const handleLedgerEvent = useCallback(
    (event: LedgerEvent) => {
      if (event.source !== "harness" || !event.runId) return;
      const registry = runRegistryRef.current!;
      const label = registry.labelFor(event.runId);
      if (!label) return; // not a run we dispatched this session
      const spec = NARRATE[event.kind];
      if (!spec) return;
      const text = spec.render(event.payload);
      pushEvent({
        kind: event.kind === "run_failed" ? "failed" : event.kind === "run_done" ? "completed" : "info",
        label: `Run '${label}': ${event.kind}`,
        detail: text,
      });
      if (event.kind === "run_done" || event.kind === "run_failed") {
        registry.remove(event.runId);
      } else {
        registry.setStatus(event.runId, event.kind === "run_blocked" ? "blocked" : "active");
      }
      narrationQueueRef.current!.enqueue({ priority: spec.priority, kind: event.kind, text, label });
      tryDrain();
    },
    [tryDrain],
  );

  const dispatchToolCall = useCallback(
    async (callId: string, name: string, args: Record<string, unknown>) => {
      const callBus = async (body: Record<string, unknown>) => {
        const res = await fetch("/api/bus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (res.ok ? await res.json() : { error: await res.text() }) as Record<
          string,
          unknown
        >;
        return { ok: res.ok, data };
      };

      const registry = runRegistryRef.current!;

      try {
        if (name === "delegate_task") {
          const instruction =
            typeof args.instruction === "string" ? args.instruction : "";
          const requestedLabel = typeof args.label === "string" ? args.label : "";
          pushEvent({
            kind: "dispatched",
            label: `Tool call: delegate_task (${requestedLabel || "—"})`,
            detail: instruction || "(no instruction)",
          });
          const { ok, data } = await callBus({
            action: "dispatch",
            instruction,
            label: requestedLabel,
          });
          if (ok && typeof data.runId === "string") {
            // Register → canonical label (collision-suffixed); hand it back so the model re-syncs.
            const canonical = registry.register(data.runId, requestedLabel);
            pushEvent({
              kind: "awaiting",
              label: `Run dispatched: '${canonical}'`,
              detail: `run ${data.runId}`,
            });
            sendToolResult(callId, JSON.stringify({ ...data, label: canonical }));
          } else {
            sendToolResult(callId, JSON.stringify(data));
          }
          return;
        }

        if (name === "answer_run") {
          const label = typeof args.label === "string" ? args.label : "";
          const text = typeof args.text === "string" ? args.text : "";
          pushEvent({ kind: "info", label: `Tool call: answer_run ('${label}')`, detail: text });
          const runId = registry.resolveLabel(label);
          if (!runId) {
            sendToolResult(callId, JSON.stringify({ error: `no run labeled '${label}'` }));
            return;
          }
          const { data } = await callBus({ action: "answer", runId, text });
          sendToolResult(callId, JSON.stringify(data));
          return;
        }

        if (name === "cancel_run") {
          const label = typeof args.label === "string" ? args.label : "";
          const reason = typeof args.reason === "string" ? args.reason : undefined;
          pushEvent({
            kind: "cancelled",
            label: `Tool call: cancel_run ('${label}')`,
            detail: reason ?? "(no reason given)",
          });
          const runId = registry.resolveLabel(label);
          if (!runId) {
            sendToolResult(callId, JSON.stringify({ error: `no run labeled '${label}'` }));
            return;
          }
          const { data } = await callBus({ action: "cancel", runId, reason });
          registry.remove(runId);
          sendToolResult(callId, JSON.stringify(data));
          return;
        }

        pushEvent({
          kind: "error",
          label: `Unknown tool call: ${name}`,
          payload: args,
        });
        sendToolResult(callId, JSON.stringify({ error: `unknown tool ${name}` }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pushEvent({ kind: "error", label: "Bus call failed", detail: message });
        sendToolResult(callId, JSON.stringify({ error: message }));
      }
    },
    [sendToolResult],
  );

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setApiKey(stored);
      return;
    }
    fetch("/api/session")
      .then((r) => r.json())
      .then((data: { hasServerKey?: boolean }) => {
        if (data.hasServerKey) setApiKey("__server__");
      })
      .catch(() => {});
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
      if (apiKey && apiKey !== "__server__") headers["x-openai-key"] = apiKey;

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

  // Record Ed's spoken output (the edmini → User boundary crossing) in the ledger (edmini-rv9), so
  // the whole conversation is durable/auditable, not just live in the browser. Fire-and-forget.
  const logVoiceOutput = useCallback((text: string) => {
    if (!text.trim()) return;
    void fetch("/api/voice-output", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => {});
  }, []);

  const stopProgressTicker = useCallback(() => {
    if (progressTickerRef.current) {
      clearInterval(progressTickerRef.current);
      progressTickerRef.current = null;
    }
  }, []);

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
      userSpeakingRef.current = true; // never narrate over the User
      edInitiatedPendingRef.current = false; // the User is speaking → the next turn is theirs
      pushEvent({ kind: "user_spoke", label: "User started speaking" });
    }
    if (type === "input_audio_buffer.speech_stopped") {
      userSpeakingRef.current = false;
      pushEvent({ kind: "user_paused", label: "User paused" });
      tryDrain(); // channel may now be free for a queued update
    }
    if (type === "response.created") {
      responseActiveRef.current = true; // a response is in flight (ours or model-initiated)
    }
    if (type === "response.output_audio.delta") {
      setStatus("speaking");
      if (!modelSpeakingFlagRef.current) {
        modelSpeakingFlagRef.current = true;
        pushEvent({ kind: "model_speaking", label: "Model started speaking" });
        // mb0: snapshot the audio clock and start advancing the spoken cursor for the active turn.
        audioStartRef.current = audioElRef.current?.currentTime ?? null;
        stopProgressTicker();
        progressTickerRef.current = setInterval(() => {
          const audioEl = audioElRef.current;
          const start = audioStartRef.current;
          const activeId = currentTurnIdRef.current;
          if (!audioEl || start === null || activeId === null) return;
          const elapsedAudioMs = Math.max(0, (audioEl.currentTime - start) * 1000);
          setTurns((prev) =>
            prev.map((t) =>
              t.id === activeId
                ? {
                    ...t,
                    spokenIndex: narrationProgressRef.current!.advance({
                      fullText: t.edText,
                      elapsedAudioMs,
                    }).spokenIndex,
                  }
                : t,
            ),
          );
        }, 100);
      }
    }
    if (type === "response.done") {
      setStatus("listening");
      modelSpeakingFlagRef.current = false;
      // mb0: stop advancing and mark the active turn fully spoken.
      stopProgressTicker();
      audioStartRef.current = null;
      const doneId = currentTurnIdRef.current;
      if (doneId !== null) {
        setTurns((prev) =>
          prev.map((t) => (t.id === doneId ? { ...t, spokenIndex: t.edText.length } : t)),
        );
      }
      onResponseEnded(); // clear in-flight, fire next queued response / drain narration
    }
    // A rejected response.create (e.g. "conversation already has an active response") arrives as an
    // error with no response.done — recover so the channel doesn't stay stuck silent.
    if (type === "error") {
      const err = serverEvent.error as { message?: string } | undefined;
      pushEvent({ kind: "error", label: "Realtime error", detail: err?.message ?? JSON.stringify(serverEvent).slice(0, 120) });
      onResponseEnded();
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
    if (type === "response.output_audio_transcript.delta" || type === "response.output_text.delta") {
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
          // Ed-initiated turn (proactive narration) → "" so no user bubble renders; a real user turn
          // stays null and gets its transcript backfilled.
          const userText = edInitiatedPendingRef.current ? "" : null;
          edInitiatedPendingRef.current = false;
          setTurns((prev) => [
            ...prev,
            { id: newId, userText, edText: delta, edStreaming: true },
          ]);
        }
      }
    }

    // Ed transcript finalized
    if (type === "response.output_audio_transcript.done" || type === "response.output_text.done") {
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
      if (type === "response.output_audio_transcript.done" && transcript) {
        logVoiceOutput(transcript); // ledger: edmini → User crossing
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
  }, [postTurnToThread, dispatchToolCall, tryDrain, onResponseEnded, logVoiceOutput, stopProgressTicker]);

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
      detail: `${newSessionId} · build ${BUILD_ID}`,
    });

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey && apiKey !== "__server__") headers["x-openai-key"] = apiKey;

      const sessionRes = await fetch("/api/session", { method: "POST", headers });
      if (!sessionRes.ok) {
        const err = await sessionRes.json();
        throw new Error(err.error ?? "Failed to create session");
      }
      const sessionData = await sessionRes.json();
      const ephemeralKey: string =
        sessionData.value ??
        sessionData.client_secret?.value ??
        sessionData.client_secret;
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

      // Subscribe the browser to the ledger so inbound harness events for the
      // active run get narrated into the live session (the Narrate half).
      try {
        ledgerChannelRef.current = ledgerFromEnv().subscribe(handleLedgerEvent);
      } catch (err) {
        pushEvent({
          kind: "error",
          label: "Ledger subscribe failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime/calls",
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
  }, [handleDataChannelMessage, handleLedgerEvent, apiKey]);

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
    ledgerChannelRef.current?.unsubscribe();
    ledgerChannelRef.current = null;
    runRegistryRef.current = createRunRegistry();
    narrationQueueRef.current = createNarrationQueue();
    pendingToolResponsesRef.current = [];
    stopProgressTicker();
    audioStartRef.current = null;
    narrationProgressRef.current = createNarrationProgress();
    userSpeakingRef.current = false;
    responseActiveRef.current = false;
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
            voice agent <span className="text-white/15 normal-case tracking-normal">· {BUILD_ID}</span>
          </p>
        </div>
        {apiKey !== "__server__" && <button
          onClick={clearKey}
          title="Change API key"
          className="mt-1 text-white/20 text-xs tracking-widest uppercase hover:text-white/40 transition-colors"
          style={{ minHeight: 36, padding: "0 4px" }}
        >
          key
        </button>}
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
              {/* User bubble — always first; placeholder until transcript arrives. Ed-initiated
                  narration turns carry userText="" and render NO user bubble. */}
              {turn.userText !== "" && (
                <div className="flex justify-end">
                  <div
                    className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed rounded-br-sm text-white ${turn.userText === null ? "opacity-40" : ""}`}
                    style={{ background: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.25)" }}
                  >
                    {turn.userText ?? "…"}
                  </div>
                </div>
              )}
              {/* Ed bubble — always second */}
              {(turn.edText || turn.edStreaming) && (
                <div className="flex justify-start">
                  <div
                    className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed rounded-bl-sm text-white/90 ${turn.edStreaming ? "opacity-60" : ""}`}
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    {turn.spokenIndex !== undefined && turn.spokenIndex < turn.edText.length ? (
                      <>
                        <span>{turn.edText.slice(0, turn.spokenIndex)}</span>
                        <span className="text-white/35">{turn.edText.slice(turn.spokenIndex)}</span>
                      </>
                    ) : (
                      turn.edText
                    )}
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
