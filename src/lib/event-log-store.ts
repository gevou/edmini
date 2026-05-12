/**
 * Event log store — client-side mirror of the server event log.
 *
 * Architecture: the **server** owns the canonical event stream (see
 * `server-event-log.ts`). This module is a *mirror* — it subscribes to
 * `/api/events/stream` via SSE, keeps a local React-friendly copy, and
 * forwards writes (`pushEvent`, `clearEvents`) to the server through
 * `/api/events/push`. Components reading via `useEventLog` get reactive
 * updates from any tab, any device, the same way.
 *
 * Two layers of events flow through:
 *   1. Voice-loop events (user_spoke, model_speaking, …) — originate
 *      client-side and POST through here.
 *   2. Supervisor events (rephrased, classified, dispatched, …) — originate
 *      server-side and arrive via SSE.
 *
 * For tests, see `_unsafeForTestPushLocal` / `_unsafeForTestReset` — they
 * bypass HTTP so unit tests can populate the store synchronously.
 */
import { useEffect, useSyncExternalStore } from "react";

export type EventLogKind =
  // Voice loop
  | "session_started"
  | "session_ended"
  | "user_spoke"
  | "user_paused"
  | "user_interrupted"
  | "model_speaking"
  // Supervisor / workflow
  | "rephrased"
  | "classified"
  | "clarification_needed"
  | "dispatched"
  | "awaiting"
  | "completed"
  | "failed"
  | "retried"
  | "cancelled"
  // Generic
  | "info"
  | "error";

export type EventLogEntry = {
  id: string;
  timestamp: number;
  kind: EventLogKind;
  /** Short headline. Shown in bold next to the icon. */
  label: string;
  /** Optional detail line. Plain text, can be a transcript snippet, JSON, etc. */
  detail?: string;
  /** Optional structured payload — rendered as <pre> when present. Useful for showing tool-call args / classify results. */
  payload?: Record<string, unknown>;
};

/* -------------------------------------------------------------------------- */
/* Internal mirror — React-friendly, fed by the SSE bootstrap below.          */
/* -------------------------------------------------------------------------- */

let entries: EventLogEntry[] = [];
const seenIds = new Set<string>();
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

function getSnapshot(): EventLogEntry[] {
  return entries;
}

/**
 * Internal: write a server-authoritative entry into the local mirror. Called
 * by the SSE bootstrap when a new event (or snapshot batch) arrives. Idempotent
 * — duplicate ids are dropped, so reconnects don't double-render.
 */
function mirrorEntry(entry: EventLogEntry): void {
  if (seenIds.has(entry.id)) return;
  seenIds.add(entry.id);
  entries = [...entries, entry];
  notify();
}

function mirrorClear(): void {
  if (entries.length === 0 && seenIds.size === 0) return;
  entries = [];
  seenIds.clear();
  notify();
}

/* -------------------------------------------------------------------------- */
/* Public reads                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Subscribe to the event log. Re-renders the calling component when entries
 * change. Also ensures the SSE bootstrap is running.
 */
export function useEventLog(): EventLogEntry[] {
  // Lazy-bootstrap on first hook mount. Idempotent — safe across re-mounts
  // and multiple component instances.
  useEffect(() => {
    bootstrapEventStream();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Non-reactive read of the current entries. For tests, debugging, and any
 * consumer that doesn't need re-renders. UI components should use useEventLog.
 */
export function getEntriesSnapshot(): readonly EventLogEntry[] {
  return entries;
}

/**
 * Subscribe to entry changes without a React hook. Returns an unsubscribe
 * function. Exposed primarily for tests; UI components should use useEventLog.
 */
export function subscribeToEvents(callback: () => void): () => void {
  return subscribe(callback);
}

/* -------------------------------------------------------------------------- */
/* Public writes — forward to the server                                       */
/* -------------------------------------------------------------------------- */

/**
 * Push a new event. POSTs to /api/events/push; the event lands in the server
 * store and comes back to *every* tab (including this one) through SSE.
 *
 * Best-effort: network failures are logged but do not throw. The local
 * mirror is *not* mutated optimistically — the server is the source of truth,
 * and the SSE fan-out is the only path to UI updates. This guarantees every
 * tab sees the same ordering regardless of who emitted.
 */
export function pushEvent(
  entry: Omit<EventLogEntry, "id" | "timestamp">,
): void {
  // Skip the network round-trip during SSR (the SSE bootstrap can't run
  // server-side, and there's no useful "push" on the server anyway —
  // supervisor code calls pushServerEvent directly).
  if (typeof window === "undefined") return;

  void fetch("/api/events/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  }).catch((err) => {
    // Network failure isn't fatal — we just don't get the event in the log.
    // Surface to the console so it's debuggable in dev.
    if (typeof console !== "undefined") {
      console.warn("[event-log] pushEvent failed:", err);
    }
  });
}

/**
 * Clear the event log. DELETEs /api/events/push; the server clears and fans
 * out a "cleared" envelope to every subscriber, including this tab.
 *
 * Local mirror is also cleared optimistically so the UI snaps to empty
 * immediately rather than waiting for the SSE round-trip.
 */
export function clearEvents(): void {
  // Optimistic local clear for snappy UI.
  mirrorClear();

  if (typeof window === "undefined") return;

  void fetch("/api/events/push", { method: "DELETE" }).catch((err) => {
    if (typeof console !== "undefined") {
      console.warn("[event-log] clearEvents failed:", err);
    }
  });
}

/**
 * Push a curated set of test events — for visual verification. The button on
 * the EventLogPanel calls this. Now staggered through the server so every
 * tab sees them appear in lockstep.
 */
export function pushTestSequence(): void {
  const seq: Array<Omit<EventLogEntry, "id" | "timestamp">> = [
    { kind: "session_started", label: "Session started" },
    {
      kind: "user_spoke",
      label: "User spoke",
      detail: "schedule that for tuesday and ping the team",
    },
    {
      kind: "rephrased",
      label: "Rephrased",
      detail:
        "create_calendar_event(title=?, when=Tuesday) + notify_team(channel=?)",
    },
    {
      kind: "classified",
      label: "Intent: schedule_event",
      payload: { confidence: 0.91, action: "schedule_event" },
    },
    {
      kind: "clarification_needed",
      label: "Missing field: title",
      detail: "asking user to clarify",
    },
    {
      kind: "user_spoke",
      label: "User spoke",
      detail: "team standup",
    },
    {
      kind: "dispatched",
      label: "Dispatched: calendar_create",
      payload: { title: "team standup", when: "2026-05-12T09:00:00" },
    },
    {
      kind: "awaiting",
      label: "Awaiting external system",
      detail: "google calendar API",
    },
    {
      kind: "completed",
      label: "Completed: calendar_create",
      payload: { event_id: "evt_abc123" },
    },
    {
      kind: "model_speaking",
      label: "Model speaking",
      detail: "scheduling team standup for Tuesday morning",
    },
  ];
  // Stagger so the panel feels alive instead of dumping all at once. Same
  // 220ms cadence as before — preserved for visual continuity.
  seq.forEach((entry, i) => {
    setTimeout(() => pushEvent(entry), i * 220);
  });
}

/* -------------------------------------------------------------------------- */
/* SSE bootstrap — single shared EventSource per tab                           */
/* -------------------------------------------------------------------------- */

type StreamEnvelope =
  | { type: "snapshot"; entries: EventLogEntry[] }
  | { type: "event"; entry: EventLogEntry }
  | { type: "cleared" };

let bootstrapped = false;
let activeSource: EventSource | null = null;

/**
 * Open (or no-op if already open) the SSE connection to the server event
 * log. Idempotent — safe to call from every component on every render.
 *
 * Server-only callers (SSR, tests) get a no-op.
 */
export function bootstrapEventStream(): void {
  if (bootstrapped) return;
  if (typeof window === "undefined") return;
  if (typeof EventSource === "undefined") return;
  bootstrapped = true;

  const open = () => {
    const source = new EventSource("/api/events/stream");
    activeSource = source;

    source.onmessage = (e) => {
      let envelope: StreamEnvelope;
      try {
        envelope = JSON.parse(e.data as string) as StreamEnvelope;
      } catch {
        return;
      }
      if (envelope.type === "snapshot") {
        // Snapshot replaces the mirror entirely (server is authoritative).
        // Reset seenIds + entries first so subsequent mirrorEntry calls in
        // this batch are not deduped against a stale set.
        seenIds.clear();
        entries = [];
        for (const entry of envelope.entries) {
          seenIds.add(entry.id);
        }
        entries = [...envelope.entries];
        notify();
      } else if (envelope.type === "event") {
        mirrorEntry(envelope.entry);
      } else if (envelope.type === "cleared") {
        mirrorClear();
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects with exponential backoff. We just leave
      // it be; if the user closes the tab the GC will clean up.
    };
  };

  open();
}

/* -------------------------------------------------------------------------- */
/* Test-only escape hatches — do not use from app code                         */
/* -------------------------------------------------------------------------- */

/**
 * **Test-only.** Synchronously push an entry into the local mirror, bypassing
 * the server round-trip. Used by unit tests to populate the store without an
 * HTTP layer.
 *
 * Production code MUST use `pushEvent` instead.
 */
export function _unsafeForTestPushLocal(
  entry: Omit<EventLogEntry, "id" | "timestamp">,
): EventLogEntry {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const stored: EventLogEntry = { ...entry, id, timestamp: Date.now() };
  mirrorEntry(stored);
  return stored;
}

/**
 * **Test-only.** Reset the mirror state + bootstrap flag. Lets tests start
 * each case from a clean slate without invoking the network DELETE path.
 */
export function _unsafeForTestReset(): void {
  entries = [];
  seenIds.clear();
  notify();
  bootstrapped = false;
  activeSource?.close();
  activeSource = null;
}
