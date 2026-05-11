/**
 * Server-store transport — writes supervisor events directly into the
 * server-side event log. This is the production transport used by
 * `/api/intent/classify`.
 *
 * Architecture: supervisor → server event store → SSE fan-out → all client
 * tabs. No coupling between the request lifecycle and event delivery — the
 * route can return its JSON ack as soon as processTurn resolves, and events
 * continue to flow to subscribers independently.
 */
import { pushServerEvent } from "@/lib/server-event-log";
import type { SupervisorEvent, SupervisorTransport } from "../types";

export function createServerStoreTransport(): SupervisorTransport {
  return {
    emit(event: SupervisorEvent) {
      pushServerEvent({
        kind: event.kind,
        label: event.label,
        detail: event.detail,
        payload: event.payload,
      });
    },
  };
}
