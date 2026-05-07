/**
 * Event log store — typed conversation-flow event stream for the supervisor demo.
 *
 * Two layers of events:
 *   1. Voice-loop events (from Realtime API): user spoke, paused, interrupted, model speaking
 *   2. Supervisor events (from intent/workflow backend): rephrased, classified, dispatched, completed, cancelled
 *
 * Stored in a module-level array, exposed via useSyncExternalStore so any component
 * can subscribe. Push events from anywhere by importing pushEvent.
 *
 * No external state library — keeps the dep tree as it is today.
 */
import { useSyncExternalStore } from "react";

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

let entries: EventLogEntry[] = [];
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
 * Subscribe to the event log. Re-renders the calling component when entries change.
 */
export function useEventLog(): EventLogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Push a new event onto the log. Safe to call from anywhere — components subscribed
 * via useEventLog will re-render.
 */
export function pushEvent(entry: Omit<EventLogEntry, "id" | "timestamp">): void {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  entries = [...entries, { ...entry, id, timestamp: Date.now() }];
  notify();
}

/**
 * Clear the event log.
 */
export function clearEvents(): void {
  entries = [];
  notify();
}

/**
 * Push a curated set of test events — for visual verification before wiring the
 * real voice / workflow plumbing. Triggered from the panel's "Test" button.
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
  // Stagger the events so the panel feels alive instead of dumping all at once
  seq.forEach((entry, i) => {
    setTimeout(() => pushEvent(entry), i * 220);
  });
}
