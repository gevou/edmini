"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import EventLogPanel from "@/components/EventLogPanel";
import { pushEvent } from "@/lib/event-log-store";
import type { LedgerEvent } from "@/lib/ledger";
import { selectCatchUp } from "@/lib/ledger";
import { ledgerFromEnv } from "@/lib/ledger-supabase";
import { createRunRegistry, buildRegistryFromEvents, type RunRegistry } from "@/lib/voice/run-registry";
import {
  createNarrationQueue,
  type NarrationBatch,
  type NarrationQueue,
  type Priority,
} from "@/lib/voice/narration-queue";
import { createNarrationProgress, type NarrationProgress } from "@/lib/voice/narration-progress";
import { createBrowserTargetSpeakerVad, createLocalStorageRosterStore, createSpeakerClassifier, rosterMemberLabel, TSVAD_MODEL_URL, type TargetSpeakerVad, type Enrollment, type Roster, type SpeakerClassifier } from "@/lib/tsvad";
import { createUtteranceGrader, type UtteranceGrader } from "@/lib/voice/utterance-grader";
import { isLikelyNonSpeech, type TranscriptLogprob } from "@/lib/voice/transcript-confidence";
import { VoiceEnrollment } from "@/lib/tsvad/ui/VoiceEnrollment";

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
  ts: number; // ms epoch when this turn was created (for the UI timestamp)
  grade?: number; // speaker-ID confidence on a RESPONDED turn when enrolled (hy8); undefined = no chip
  speaker?: string; // attributed display name from the N-speaker classifier (q1e); undefined = no label
}

type AgentStatus = "idle" | "connecting" | "listening" | "speaking" | "error";

const STORAGE_KEY = "ed_openai_key";
const LAST_SEEN_SEQ_KEY = "edmini.lastSeenSeq";
// Surfaced in the header + logged on session start so it's unambiguous which bundle is running.
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "unknown";

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Speaker-ID confidence → chip color: green (clearly you), amber (borderline), red (low). */
function gradeColor(g: number): string {
  if (g >= 0.55) return "#4ade80";
  if (g >= 0.4) return "#fbbf24";
  return "#f87171";
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
  const [showEnroll, setShowEnroll] = useState(false);
  // Inline rename of a roster voice (edmini-mfl): which member is being edited + the draft name.
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  // The LIVE grading state this session. "active" = model loaded (gates if enrolled, else pass-through);
  // "unavailable" = model failed → fail-open (responding to all); null = no live session.
  const [gradingState, setGradingState] = useState<"active" | "unavailable" | null>(null);
  // The roster as real state so the management UI re-renders on change (persists across sessions). The
  // rosterRef mirror is for non-React reads in callbacks (classifier id→name); commitRoster keeps both in sync.
  const [roster, setRosterUi] = useState<Roster>({ principalId: null, members: [] });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  // The raw mic track + its WebRTC sender, so we can mute it TO OpenAI during enrollment (replaceTrack
  // null) without disturbing the TS-VAD tap, which reads the mic via its own AudioContext.
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const micSenderRef = useRef<RTCRtpSender | null>(null);
  // True while the enrollment modal is open: mic is muted to OpenAI and narration is paused, so Ed
  // doesn't respond to the recited passage or speak background updates mid-enrollment.
  const enrollingRef = useRef<boolean>(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const pendingUserTextRef = useRef<string | null>(null);
  const pendingEdTextRef = useRef<string | null>(null);
  const turnCounterRef = useRef(0);
  const currentTurnIdRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const voiceThreadIdRef = useRef<string | null>(null);
  const vadRef = useRef<TargetSpeakerVad | null>(null);
  const graderRef = useRef<UtteranceGrader | null>(null);
  if (!graderRef.current) graderRef.current = createUtteranceGrader();
  const suppressedTurnRef = useRef<{ itemId: string; confidence: number } | null>(null);
  // Flag: the turn in flight is an ENROLLED non-principal to REMEMBER (q1e) — kept in Ed's context (not
  // deleted, no response) and rendered standalone. Its speaker is the canonical turnSpeakerRef below.
  const retainedTurnRef = useRef<boolean>(false);
  // Grade to attach to the next RESPONDED user turn (hy8). Set on a respond decision when enrolled,
  // consumed when that turn's transcript backfills. Null = no chip (grading off / not enrolled).
  const lastRespondGradeRef = useRef<number | null>(null);
  // Flag: a NOT-enrolled (pass-through) respond turn whose response was DEFERRED at commit (edmini-put).
  // There's no speaker evidence to gate on, so we wait for the transcript+logprobs and reject non-speech
  // whisper hallucinations (e.g. a beep → "Bye-bye") before firing the response or logging the turn.
  const passthroughPendingRef = useRef<boolean>(false);
  // N-speaker classifier (q1e): runs alongside the grader for identification-only labeling.
  const classifierRef = useRef<SpeakerClassifier | null>(null);
  if (!classifierRef.current) classifierRef.current = createSpeakerClassifier();
  // Roster held for id→name mapping in the UI (q1e). Loaded at session start.
  const rosterRef = useRef<Roster | null>(null);
  // The ONE canonical speaker for the turn in flight (q1e): principal's name when the gate responded,
  // the roster member's name when retained, null when there's no attribution (→ "User"). Set once on
  // committed; consumed on transcript backfill to write BOTH the ledger (user_utterance.speaker) and the
  // UI turn from the same value — so "who said it" is recorded one way, not three.
  const turnSpeakerRef = useRef<string | null>(null);
  const modelSpeakingFlagRef = useRef<boolean>(false);
  const ledgerChannelRef = useRef<RealtimeChannel | null>(null);
  const lastProcessedSeqRef = useRef<number>(0);
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
  // Wall-clock timestamp (performance.now()) at this utterance's audio start. NB: audioEl.currentTime
  // does NOT advance for a WebRTC MediaStream, so we time playback by wall clock (audio plays ~realtime).
  const audioStartRef = useRef<number | null>(null);
  const speakingTurnIdRef = useRef<number | null>(null); // the turn the cursor is sweeping (survives currentTurnIdRef→null)
  const reachedFullRef = useRef<boolean>(false); // set when the cursor hits the end → stop the ticker
  const progressTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fire one response: send its conversation item(s), then response.create, marking a response in
  // flight. Only call when responseActiveRef is false.
  const fireResponse = useCallback((sendItems: () => void, response?: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    responseActiveRef.current = true;
    sendItems();
    dc.send(JSON.stringify(response ? { type: "response.create", response } : { type: "response.create" }));
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
                  text: `(System update — relay to the User naturally and briefly, in your own words; name the task when more than one is in flight; do not read verbatim. Relay ONLY what this says; do NOT claim the task is done/created/ready unless it is tagged "finished". A "reported" update is progress, not completion.) ${lines}`,
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
      !!dc && dc.readyState === "open" && !userSpeakingRef.current && !responseActiveRef.current
      && !enrollingRef.current; // don't narrate mid-enrollment
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
  // The run is NOT evicted on run_done/run_failed: the harness streams many messages per task (intent,
  // tool steps, then the real "Done!" — often with a follow-up question), and an early/false run_done
  // would otherwise drop every later event (including a genuine question). Runs are evicted only on
  // cancel_run or session end. We just track status. See edmini-5ze / the interpreter follow-up.
  const handleLedgerEvent = useCallback(
    (event: LedgerEvent) => {
      if (event.source !== "harness" || !event.runId) return;
      if ((event.seq ?? 0) <= lastProcessedSeqRef.current) return; // snapshot↔subscribe idempotency
      lastProcessedSeqRef.current = Math.max(lastProcessedSeqRef.current, event.seq ?? 0);
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
      registry.setStatus(
        event.runId,
        event.kind === "run_failed"
          ? "failed"
          : event.kind === "run_done"
            ? "done"
            : event.kind === "run_blocked"
              ? "blocked"
              : "active",
      );
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
          const prevRunId = registry.resolveLabel(requestedLabel); // raw provenance fact (null if first use)
          const { ok, data } = await callBus({
            action: "dispatch",
            instruction,
            label: requestedLabel,
            prevRunId,
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

        if (name === "search_history") {
          pushEvent({ kind: "info", label: "Tool call: search_history", detail: JSON.stringify(args).slice(0, 120) });
          const res = await fetch("/api/history", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args),
          });
          const data = (res.ok ? await res.json() : { error: await res.text() }) as Record<string, unknown>;
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

  const postTurnToTopic = useCallback(async (userText: string, edText: string) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey && apiKey !== "__server__") headers["x-openai-key"] = apiKey;

      const res = await fetch("/api/topics/classify", {
        method: "POST",
        headers,
        body: JSON.stringify({ utterance: userText }),
      });
      if (!res.ok) return;
      const { topicId } = await res.json() as { topicId: string };
      if (topicId === "general") return;
      await Promise.all([
        fetch(`/api/topics/${topicId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: userText }),
        }),
        fetch(`/api/topics/${topicId}/message`, {
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

  const recordVoiceThread = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch("/api/threads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ medium: "voice", transport: "openai-realtime", apiIdentifier: sessionId, runId: null }),
      });
      if (res.ok) voiceThreadIdRef.current = (await res.json()).threadId as string;
    } catch { /* non-blocking */ }
  }, []);

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

  // Log a bystander's words that were heard but not acted on (suppressed turns).
  const recordHeard = useCallback((text: string | null, confidence: number) => {
    void fetch("/api/heard", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, confidence, threadId: voiceThreadIdRef.current }),
    }).catch(() => {});
  }, []);

  // Log a finalized User turn (User → edmini crossing) to the ledger (edmini-iee §4). Fire-and-forget.
  // `speaker` (q1e) attributes an enrolled non-principal turn by name, so it's remembered as theirs.
  const logUserUtterance = useCallback((text: string, speaker?: string) => {
    if (!text.trim()) return;
    void fetch("/api/conversation/utterance", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, threadId: voiceThreadIdRef.current, speaker }),
    }).catch(() => {});
  }, []);

  // Persist a roster change everywhere at once: ref (for callbacks), state (for the UI), localStorage,
  // and the live VAD (so scoring picks it up immediately if a session is active).
  const commitRoster = useCallback((r: Roster) => {
    rosterRef.current = r;
    setRosterUi(r);
    try { createLocalStorageRosterStore().save(r); } catch { /* ignore */ }
    vadRef.current?.setRoster(r);
  }, []);

  // Commit an inline rename (edmini-mfl): set the member's name (blank → cleared, reverts to "Speaker N").
  const saveRename = useCallback((id: string) => {
    setEditingMemberId(null);
    const r = rosterRef.current;
    if (!r) return;
    const trimmed = draftName.trim();
    commitRoster({ ...r, members: r.members.map((m) => (m.id === id ? { ...m, name: trimmed || undefined } : m)) });
  }, [draftName, commitRoster]);

  // Load the persisted roster on mount so the management UI shows it even before a session starts.
  useEffect(() => {
    try { const r = createLocalStorageRosterStore().load(); rosterRef.current = r; setRosterUi(r); } catch { /* ignore */ }
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
      graderRef.current!.begin();
      classifierRef.current!.begin();
    }
    if (type === "input_audio_buffer.speech_stopped") {
      userSpeakingRef.current = false;
      pushEvent({ kind: "user_paused", label: "User paused" });
      tryDrain(); // channel may now be free for a queued update
    }
    if (type === "input_audio_buffer.committed") {
      const itemId = serverEvent.item_id as string | undefined;
      const { decision, confidence } = graderRef.current!.end();
      // Attribution (q1e): the N-speaker classifier runs alongside the grader. We resolve ONE canonical
      // speaker for the turn (recorded the same way in the ledger and the UI).
      const who = classifierRef.current!.end();
      const roster = rosterRef.current;
      const principal = roster?.members.find((m) => m.id === roster.principalId);

      if (decision === "respond") {
        // The gate accepted this as the principal → attribute to the principal (not the raw classifier
        // label, which can be "unknown" near the margin). Null name → recorded/rendered as "User".
        pushEvent({ kind: "info", label: "Grade: respond", detail: `conf ${confidence.toFixed(2)}` });
        turnSpeakerRef.current = principal?.name ?? null;
        const enrolled = vadRef.current?.isEnrolled() ?? false;
        lastRespondGradeRef.current = enrolled ? confidence : null;
        if (enrolled) {
          // Speaker-gated: a beep already scored below the centroid → suppressed above, so a turn that
          // reaches here is genuinely the principal. Respond immediately (no added latency).
          fireResponse(() => {}, { metadata: { src: "client" } });
        } else {
          // Pass-through (not enrolled): no speaker evidence to reject a non-speech beep. Defer the
          // response until the transcript + logprobs arrive so we can drop whisper hallucinations (put).
          passthroughPendingRef.current = true;
        }
      } else {
        // Grader says not-the-principal. Distinguish an ENROLLED non-principal (remember + attribute,
        // don't act) from a genuinely unknown speaker (delete + heard, forgotten).
        const member = who.label !== "unknown" ? roster?.members.find((m) => m.id === who.label) : undefined;
        if (member && member.id !== roster?.principalId) {
          // RETAIN: keep the item in Ed's context (in-session awareness) and do NOT respond. The
          // transcript renders attributed and is logged as an attributed user_utterance (durable memory).
          pushEvent({ kind: "info", label: `Heard ${member.name ?? member.id} (not acting)`, detail: `conf ${confidence.toFixed(2)}` });
          turnSpeakerRef.current = member.name ?? member.id;
          retainedTurnRef.current = true;
        } else {
          // Best-effort delete of the auto-committed item (keep it out of context); mark the turn
          // suppressed so its transcript is logged as `heard`, not rendered — even on a missing item_id.
          pushEvent({ kind: "info", label: "Grade: suppress (not you)", detail: `conf ${confidence.toFixed(2)}` });
          if (itemId) dcRef.current?.send(JSON.stringify({ type: "conversation.item.delete", item_id: itemId }));
          suppressedTurnRef.current = { itemId: itemId ?? "", confidence };
        }
        lastRespondGradeRef.current = null;
      }
      return;
    }
    if (type === "response.created") {
      responseActiveRef.current = true; // a response is in flight (ours or model-initiated)
    }
    if (type === "response.output_audio.delta") {
      setStatus("speaking");
      if (!modelSpeakingFlagRef.current) {
        modelSpeakingFlagRef.current = true;
        pushEvent({ kind: "model_speaking", label: "Model started speaking" });
        // mb0: start sweeping the spoken cursor for this utterance, timed by wall clock.
        // Finalize any previous speaking turn (safety) and target the active one. Its id is captured
        // here so the cursor keeps advancing even after currentTurnIdRef is cleared at transcript.done.
        const prevSpeaking = speakingTurnIdRef.current;
        if (prevSpeaking !== null) {
          setTurns((prev) => prev.map((t) => (t.id === prevSpeaking ? { ...t, spokenIndex: t.edText.length } : t)));
        }
        audioStartRef.current = performance.now();
        speakingTurnIdRef.current = currentTurnIdRef.current;
        reachedFullRef.current = false;
        stopProgressTicker();
        progressTickerRef.current = setInterval(() => {
          if (reachedFullRef.current) {
            stopProgressTicker();
            return;
          }
          const id = speakingTurnIdRef.current;
          const start = audioStartRef.current;
          if (id === null || start === null) return;
          const elapsedAudioMs = performance.now() - start;
          setTurns((prev) =>
            prev.map((t) => {
              if (t.id !== id) return t;
              const { spokenIndex } = narrationProgressRef.current!.advance({
                fullText: t.edText,
                elapsedAudioMs,
              });
              reachedFullRef.current = t.edText.length > 0 && spokenIndex >= t.edText.length;
              return { ...t, spokenIndex };
            }),
          );
        }, 100);
      }
    }
    if (type === "response.done") {
      setStatus("listening");
      modelSpeakingFlagRef.current = false;
      // mb0: do NOT snap to full here — response.done fires when generation finishes, but the audio is
      // still playing out. The wall-clock ticker keeps sweeping and reaches full on its own.
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
            { id: newId, userText, edText: delta, edStreaming: true, ts: Date.now() },
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
          postTurnToTopic(userText, transcript);
        } else {
          pendingEdTextRef.current = transcript;
        }
      }
    }

    // User transcript — always arrives after Ed's response; backfill into most recent unmatched turn
    if (type === "conversation.item.input_audio_transcription.completed") {
      // Enrolled non-principal (q1e): remember + show it, attributed, without an Ed response.
      if (retainedTurnRef.current) {
        retainedTurnRef.current = false;
        const speaker = turnSpeakerRef.current ?? undefined;
        turnSpeakerRef.current = null;
        const text = (serverEvent.transcript as string | undefined)?.trim();
        const itemId = serverEvent.item_id as string | undefined;
        if (text) {
          // In-session attribution adapter: a Realtime message item has no speaker field (verified against
          // the OpenAI OpenAPI spec — items are id/object/type/status/role/content only). So replace the
          // nameless audio item OpenAI authored with an attributed text item, rendering the same
          // turnSpeakerRef into text. No response is fired (grading mode → create_response:false), so Ed
          // becomes AWARE of who said what without acting on it.
          if (itemId) dcRef.current?.send(JSON.stringify({ type: "conversation.item.delete", item_id: itemId }));
          dcRef.current?.send(JSON.stringify({
            type: "conversation.item.create",
            item: { type: "message", role: "user", content: [{ type: "input_text", text: `${speaker ?? "Someone"}: ${text}` }] },
          }));
          logUserUtterance(text, speaker); // durable, attributed memory (feeds iee Recent-history)
          pushEvent({ kind: "user_spoke", label: `${speaker ?? "Someone"} (heard)`, detail: text });
          const newId = ++turnCounterRef.current;
          setTurns((prev) => [...prev, { id: newId, userText: text, edText: "", edStreaming: false, ts: Date.now(), speaker }]);
        }
        return;
      }
      if (suppressedTurnRef.current) {
        const { confidence } = suppressedTurnRef.current;
        suppressedTurnRef.current = null;
        const t = (serverEvent.transcript as string | undefined)?.trim() ?? null;
        recordHeard(t, confidence);
        return;
      }
      const transcript = serverEvent.transcript as string | undefined;
      const text = transcript?.trim() ?? "";
      // Pass-through deferred-response gate (edmini-put): for a NOT-enrolled turn the response was held at
      // commit. Now that we have the transcript + logprobs, reject non-speech whisper hallucinations (a
      // system beep → "Bye-bye") so they never fire a phantom response or log a fake user_utterance.
      if (passthroughPendingRef.current) {
        passthroughPendingRef.current = false;
        const logprobs = serverEvent.logprobs as TranscriptLogprob[] | undefined;
        if (!text || isLikelyNonSpeech({ transcript: text, logprobs })) {
          pushEvent({ kind: "info", label: "Dropped non-speech (pass-through)", detail: text || "(empty)" });
          recordHeard(text || null, 0); // logged as `heard`, not a user_utterance; no response fired
          turnSpeakerRef.current = null;
          lastRespondGradeRef.current = null;
          return;
        }
        // Genuine speech → fire the response we deferred at commit, then fall through to log/render it.
        fireResponse(() => {}, { metadata: { src: "client" } });
      }
      if (text) {
        const grade = lastRespondGradeRef.current ?? undefined; // speaker-ID confidence for this answered turn
        lastRespondGradeRef.current = null;
        const speaker = turnSpeakerRef.current ?? undefined; // the ONE canonical speaker (q1e)
        turnSpeakerRef.current = null;
        logUserUtterance(text, speaker); // ledger gets the same speaker the UI does (single source)
        pushEvent({ kind: "user_spoke", label: "User transcript", detail: text });
        setTurns((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].userText === null) {
              return prev.map((t, idx) =>
                idx === i ? { ...t, userText: text, grade, speaker } : t
              );
            }
          }
          // No unmatched turn — create standalone user turn
          const newId = ++turnCounterRef.current;
          return [...prev, { id: newId, userText: text, edText: "", edStreaming: false, ts: Date.now(), grade, speaker }];
        });
        const edText = pendingEdTextRef.current;
        if (edText) {
          pendingUserTextRef.current = null;
          pendingEdTextRef.current = null;
          postTurnToTopic(text, edText);
        } else {
          pendingUserTextRef.current = text;
        }
      }
    }
  }, [postTurnToTopic, dispatchToolCall, tryDrain, onResponseEnded, logVoiceOutput, stopProgressTicker, recordHeard, logUserUtterance, fireResponse]);

  const startSession = useCallback(async () => {
    setErrorMsg(null);
    setStatus("connecting");

    const newSessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `sess_${crypto.randomUUID()}`
        : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessionIdRef.current = newSessionId;
    void recordVoiceThread(newSessionId);
    pushEvent({
      kind: "session_started",
      label: "Voice session started",
      detail: `${newSessionId} · build ${BUILD_ID}`,
    });

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey && apiKey !== "__server__") headers["x-openai-key"] = apiKey;

      // The principal's name (if any) → so Ed's system prompt can address the user by name (hy8).
      // Read from the roster store (single source of truth); legacy enrollment store no longer used.
      let enrolledName: string | undefined;
      try {
        const roster = createLocalStorageRosterStore().load();
        const principal = roster.members.find((m) => m.id === roster.principalId);
        enrolledName = principal?.name;
      } catch { /* ignore */ }

      const sessionRes = await fetch("/api/session", {
        method: "POST", headers,
        body: JSON.stringify({ grading: true, userName: enrolledName }),
      });
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

      // Enable the browser's audio processing so the mic doesn't re-capture Ed's own voice on
      // speakerphone (which server-VAD would treat as new user turns → feedback loop). Partial
      // mitigation; the real fix is target-speaker VAD (edmini-qo3).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      {
        // Speaker ID is always on now (hy8): the VAD always runs; enrollment decides whether it gates
        // (enrolled → gate to you; not enrolled → pass-through). The on/off toggle is gone.
        // Load the roster for id→name mapping (q1e). The VAD loads it internally too; this ref is only for UI attribution.
        try { const r = createLocalStorageRosterStore().load(); rosterRef.current = r; setRosterUi(r); } catch { /* keep current */ }
        try {
          const vad = await createBrowserTargetSpeakerVad({ modelUrl: TSVAD_MODEL_URL });
          await vad.start(stream);                       // taps the mic; does NOT consume it
          vad.onScore((e) => {
            graderRef.current!.addScore(e.raw, e.level);
            classifierRef.current!.addWindow(e.scores ?? [], e.level);
          });
          vadRef.current = vad;
          setGradingState("active");
          pushEvent({ kind: "info", label: "Speaker grading active", detail: vad.isEnrolled() ? (enrolledName ? `enrolled as ${enrolledName}` : "enrolled") : "pass-through (enroll to gate)" });
        } catch (err) {
          vadRef.current = null;                          // fail open — no scores → grader always responds
          setGradingState("unavailable");
          pushEvent({ kind: "error", label: "Speaker grading unavailable (responding to all)", detail: err instanceof Error ? err.message : String(err) });
        }
      }
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      // Keep the mic track + its sender so we can mute it to OpenAI during enrollment.
      micTrackRef.current = stream.getAudioTracks()[0] ?? null;
      micSenderRef.current = pc.getSenders().find((s) => s.track?.kind === "audio") ?? null;

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = handleDataChannelMessage;

      // Rehydrate the registry + compute catch-up from a ledger snapshot (edmini-iee §1/§2). Fail open.
      let catchUpBatch: NarrationBatch = [];
      try {
        const ledger = ledgerFromEnv();
        const snap = await ledger.snapshot();
        const rebuilt = buildRegistryFromEvents(snap);
        runRegistryRef.current = rebuilt;
        const maxSeq = snap.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
        const lastSeen = Number(localStorage.getItem(LAST_SEEN_SEQ_KEY) ?? "0");
        lastProcessedSeqRef.current = maxSeq;
        if (lastSeen > 0) {
          const known = new Set(snap.filter((e) => e.kind === "task_dispatch" && e.runId).map((e) => e.runId as string));
          catchUpBatch = selectCatchUp(snap, lastSeen, known).map((e) => ({
            priority: NARRATE[e.kind]?.priority ?? "low",
            kind: e.kind,
            label: rebuilt.labelFor(e.runId as string) ?? undefined,
            text: NARRATE[e.kind]?.render(e.payload) ?? e.kind,
          }));
        }
      } catch (err) {
        pushEvent({ kind: "error", label: "Rehydrate failed (starting fresh)", detail: err instanceof Error ? err.message : String(err) });
      }

      dc.onopen = () => {
        if (catchUpBatch.length) {
          edInitiatedPendingRef.current = true;
          const lines = catchUpBatch.map((i) => (i.label ? `Run '${i.label}' ${i.text}` : i.text)).join(". ");
          fireResponse(() =>
            dcRef.current?.send(JSON.stringify({
              type: "conversation.item.create",
              item: { type: "message", role: "user", content: [{ type: "input_text",
                text: `(While you were away, these updates arrived — relay them to the User briefly as a catch-up, in your own words; name each task; relay ONLY what they say, do not claim completion unless tagged finished.) ${lines}` }] },
            })),
          );
        }
      };

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
  }, [handleDataChannelMessage, handleLedgerEvent, fireResponse, apiKey, recordVoiceThread]);

  // Enter/leave enrollment: while enrolling, mute the mic TO OpenAI (replaceTrack null) so Ed can't hear
  // the recited passage, and pause narration. The TS-VAD tap is unaffected (separate AudioContext), so
  // enrollment capture still works. Restored when enrollment ends.
  const setEnrolling = useCallback((active: boolean) => {
    enrollingRef.current = active;
    void micSenderRef.current?.replaceTrack(active ? null : micTrackRef.current);
    pushEvent({
      kind: "info",
      label: active ? "Enrolling — Ed paused (mic muted to model)" : "Enrollment ended — Ed resumed",
    });
    if (!active) tryDrain(); // flush anything that queued while paused
  }, [tryDrain]);

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
    void vadRef.current?.stop();
    vadRef.current = null;
    graderRef.current = createUtteranceGrader();
    classifierRef.current = createSpeakerClassifier();
    // Keep the roster (it persists across sessions); just reset per-turn attribution state.
    turnSpeakerRef.current = null;
    suppressedTurnRef.current = null;
    retainedTurnRef.current = false;
    passthroughPendingRef.current = false;
    ledgerChannelRef.current?.unsubscribe();
    ledgerChannelRef.current = null;
    try { localStorage.setItem(LAST_SEEN_SEQ_KEY, String(lastProcessedSeqRef.current)); } catch { /* ignore */ }
    lastProcessedSeqRef.current = 0;
    enrollingRef.current = false;
    micTrackRef.current = null;
    micSenderRef.current = null;
    runRegistryRef.current = createRunRegistry();
    narrationQueueRef.current = createNarrationQueue();
    pendingToolResponsesRef.current = [];
    stopProgressTicker();
    audioStartRef.current = null;
    speakingTurnIdRef.current = null;
    reachedFullRef.current = false;
    narrationProgressRef.current = createNarrationProgress();
    userSpeakingRef.current = false;
    responseActiveRef.current = false;
    dcRef.current?.close();
    pcRef.current?.close();
    dcRef.current = null;
    pcRef.current = null;
    if (audioElRef.current) audioElRef.current.srcObject = null;
    modelSpeakingFlagRef.current = false;
    voiceThreadIdRef.current = null;
    setGradingState(null);
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
  // Capturing a voice needs a live session (the VAD does the recording). Viewing/managing the roster
  // does not, so the speaker-id panel always shows; only the enroll button needs an active session.
  const canEnroll = !!vadRef.current && (status === "listening" || status === "speaking");
  const accentColor = status === "speaking" ? "#a78bfa" : status === "error" ? "#f87171" : "#f59e0b";

  const buttonIcon =
    status === "connecting" ? <Spinner /> :
    status === "speaking" ? <WaveBars color={accentColor} /> :
    <MicIcon />;

  const bgColor = "#0e0a04";

  return (
    <>
    {showEnroll && vadRef.current && (
      <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.6)", zIndex: 50, padding: 16 }}>
        <VoiceEnrollment
          vad={vadRef.current}
          onComplete={(e: Enrollment) => {
            setEnrolling(false);
            setShowEnroll(false);
            // Build updated roster: first enroll → principal; subsequent → new member.
            const prev = rosterRef.current ?? { principalId: null, members: [] };
            const isPrincipal = prev.principalId === null;
            const memberId = isPrincipal ? "principal" : `member_${Date.now()}`;
            const newMember = { id: memberId, name: e.name, enrollment: e };
            const updatedMembers = [
              ...prev.members.filter((m) => m.id !== memberId),
              newMember,
            ];
            commitRoster({
              principalId: isPrincipal ? "principal" : prev.principalId,
              members: updatedMembers,
            });
            const displayName = e.name ?? memberId;
            pushEvent({ kind: "info", label: isPrincipal
              ? (e.name ? `Voice enrolled — Ed will call you ${e.name}` : "Voice enrolled — grading now gates to you")
              : `Added voice: ${displayName}` });
          }}
          onCancel={() => { setEnrolling(false); setShowEnroll(false); }}
        />
      </div>
    )}
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
        <div className="flex flex-col items-end gap-1">
          {apiKey !== "__server__" && <button
            onClick={clearKey}
            title="Change API key"
            className="mt-1 text-white/20 text-xs tracking-widest uppercase hover:text-white/40 transition-colors"
            style={{ minHeight: 36, padding: "0 4px" }}
          >
            key
          </button>}
          <span
            className="mt-1 text-white/20 text-xs tracking-widest uppercase"
            title="Ed acts only on your enrolled voice; other enrolled people are identified, not obeyed"
          >
            speaker id
          </span>
          {/* Live grading status — speaker ID is always on; enrollment decides whether it gates */}
          <span
            className="text-[10px] tracking-wide normal-case"
            title="Live speaker-grading status this session"
            style={{ color: gradingState === "unavailable" ? "#f87171" : gradingState === "active" && roster.principalId ? "#4ade80" : "rgba(255,255,255,0.30)" }}
          >
            {gradingState === "unavailable"
              ? "unavailable · responding to all"
              : gradingState === "active"
                ? (() => {
                    const p = roster.members.find((m) => m.id === roster.principalId);
                    return p ? `active — ${rosterMemberLabel(p, roster)}` : "listening · enroll to gate";
                  })()
                : "start a session to activate"}
          </span>
          <>
              <button
                onClick={() => { if (canEnroll) { setShowEnroll(true); setEnrolling(true); } }}
                disabled={!canEnroll}
                title={canEnroll ? undefined : "Start a session to add a voice"}
                className={`mt-1 text-xs tracking-widest uppercase ${canEnroll ? "text-white/20 hover:text-white/40" : "text-white/10 cursor-not-allowed"}`}
              >
                {roster.principalId ? "add another voice" : "enroll"}
              </button>
              {/* Roster member list — persists across sessions; small, unobtrusive */}
              {roster.members.length > 0 && (
                <div className="mt-1 flex flex-col items-end gap-0.5">
                  {roster.members.map((m) => (
                    <div key={m.id} className="flex items-center gap-1">
                      {/* Principal toggle (edmini-ncw): ★ = the one voice Ed gates to + responds to. */}
                      <button
                        title={m.id === roster.principalId
                          ? "Principal — the voice Ed responds to"
                          : "Make principal — Ed will respond to this voice"}
                        onClick={() => { if (m.id !== roster.principalId) commitRoster({ ...roster, principalId: m.id }); }}
                        className="text-[10px] leading-none"
                        style={{ lineHeight: 1, padding: "0 2px", color: m.id === roster.principalId ? "#f59e0b" : "rgba(255,255,255,0.20)", cursor: m.id === roster.principalId ? "default" : "pointer" }}
                      >
                        {m.id === roster.principalId ? "★" : "☆"}
                      </button>
                      {editingMemberId === m.id ? (
                        <input
                          autoFocus
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(m.id);
                            else if (e.key === "Escape") setEditingMemberId(null);
                          }}
                          onBlur={() => saveRename(m.id)}
                          placeholder={rosterMemberLabel(m, roster)}
                          maxLength={40}
                          className="text-[10px] text-white/70 tracking-wide bg-transparent outline-none w-24 text-right"
                          style={{ borderBottom: "1px solid rgba(255,255,255,0.25)" }}
                        />
                      ) : (
                        <button
                          title="Rename"
                          onClick={() => { setEditingMemberId(m.id); setDraftName(m.name ?? ""); }}
                          className="text-[10px] text-white/25 tracking-wide hover:text-white/45"
                        >
                          {rosterMemberLabel(m, roster)}
                        </button>
                      )}
                      <button
                        title={`Remove ${rosterMemberLabel(m, roster)}`}
                        onClick={() => {
                          const remaining = roster.members.filter((x) => x.id !== m.id);
                          const newPrincipalId = remaining.find((x) => x.id === roster.principalId)?.id ?? null;
                          commitRoster({ principalId: newPrincipalId, members: remaining });
                        }}
                        className="text-[10px] text-white/15 hover:text-white/40 leading-none"
                        style={{ lineHeight: 1, padding: "1px 2px" }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
        </div>
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
                <div className="flex flex-col items-end">
                  <div
                    className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed rounded-br-sm text-white ${turn.userText === null ? "opacity-40" : ""}`}
                    style={{ background: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.25)" }}
                  >
                    {turn.userText ?? "…"}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 mr-1">
                    {turn.grade !== undefined && (
                      <span
                        className="text-[10px] tabular-nums flex items-center gap-1"
                        style={{ color: gradeColor(turn.grade) }}
                        title={`Speaker-ID confidence ${turn.grade.toFixed(2)} (it's you)`}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: 9999, background: gradeColor(turn.grade), display: "inline-block" }} />
                        {turn.grade.toFixed(2)}
                      </span>
                    )}
                    {turn.speaker !== undefined && (
                      <span
                        className="text-[10px] tabular-nums"
                        style={{ color: turn.speaker === "unknown" ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.4)" }}
                        title={`Attributed speaker: ${turn.speaker}`}
                      >
                        {turn.speaker}
                      </span>
                    )}
                    <span className="text-[10px] text-white/20 tabular-nums">{fmtTime(turn.ts)}</span>
                  </div>
                </div>
              )}
              {/* Ed bubble — always second */}
              {(turn.edText || turn.edStreaming) && (
                <div className="flex flex-col items-start">
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
                  <span className="text-[10px] text-white/20 mt-1 ml-1 tabular-nums">{fmtTime(turn.ts)}</span>
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
