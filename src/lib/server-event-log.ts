/**
 * Server-side event log — the canonical, process-global source of truth for
 * the supervisor event stream.
 *
 * Mirrors the client `event-log-store` shape but lives in the Node.js process
 * (module-level singleton, shared by all routes in this server). Clients
 * (voice agent tab, dashboard tab) subscribe via SSE in `/api/events/stream`
 * and write via HTTP in `/api/events/push`.
 *
 * This module has zero React dependencies — it must be importable from API
 * routes (server-only) without dragging in client code.
 */
import type { EventLogEntry, EventLogKind } from "./event-log-store";

export type { EventLogEntry, EventLogKind };

type EventLogState = {
  entries: EventLogEntry[];
  subscribers: Set<(entry: EventLogEntry) => void>;
  clearSubscribers: Set<() => void>;
};

declare global {
  // eslint-disable-next-line no-var
  var __supervisorEventLog: EventLogState | undefined;
}

const state: EventLogState = (globalThis.__supervisorEventLog ??= {
  entries: [],
  subscribers: new Set(),
  clearSubscribers: new Set(),
});

function generateId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Append an event to the server store and fan out to every active subscriber.
 * Returns the stored entry (with id + timestamp filled in) so the caller can
 * ack synchronously with the canonical record.
 */
export function pushServerEvent(
  entry: Omit<EventLogEntry, "id" | "timestamp">,
): EventLogEntry {
  const stored: EventLogEntry = {
    ...entry,
    id: generateId(),
    timestamp: Date.now(),
  };
  state.entries = [...state.entries, stored];
  for (const fn of state.subscribers) {
    try {
      fn(stored);
    } catch {
      // swallow — subscriber bug is not the producer's problem
    }
  }
  return stored;
}

/**
 * Non-reactive read of the current entries. Used by the SSE route to send a
 * one-shot snapshot envelope to new subscribers so they catch up on history.
 */
export function getServerEntriesSnapshot(): readonly EventLogEntry[] {
  return state.entries;
}

/**
 * Subscribe to *new* events. Callback is invoked exactly once per pushed
 * event with the stored entry. Returns an unsubscribe function.
 *
 * Note: this does NOT replay history — call getServerEntriesSnapshot() first
 * if the subscriber needs to catch up.
 */
export function subscribeServer(
  callback: (entry: EventLogEntry) => void,
): () => void {
  state.subscribers.add(callback);
  return () => {
    state.subscribers.delete(callback);
  };
}

/**
 * Subscribe to clear notifications. Fires whenever clearServerEvents() is
 * called, so SSE subscribers can forward a "cleared" envelope and clients
 * can drop their local mirrors in sync.
 */
export function subscribeServerClear(callback: () => void): () => void {
  state.clearSubscribers.add(callback);
  return () => {
    state.clearSubscribers.delete(callback);
  };
}

/**
 * Empty the server store and notify clear-subscribers (the SSE route uses
 * this to fan out a "cleared" envelope to all connected clients).
 */
export function clearServerEvents(): void {
  state.entries = [];
  for (const fn of state.clearSubscribers) {
    try {
      fn();
    } catch {
      // swallow — subscriber bug is not the producer's problem
    }
  }
}
