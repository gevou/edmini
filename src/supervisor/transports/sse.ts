/**
 * SSE transport — wraps a ReadableStream controller so supervisor events flow
 * back to the client as Server-Sent Events.
 *
 * Used by `/api/intent/classify`. The client reads the stream, parses each
 * `data:` line as either a {type:"event"} or {type:"result"} envelope, and
 * pushes events into the EventLogPanel store.
 */
import type { SupervisorEvent, SupervisorTransport } from "../types";

export type SseEnvelope =
  | { type: "event"; event: SupervisorEvent }
  | { type: "result"; result: unknown }
  | { type: "error"; error: string };

export function createSseTransport(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): SupervisorTransport {
  return {
    emit(event: SupervisorEvent) {
      const envelope: SseEnvelope = { type: "event", event };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
    },
  };
}

export function writeSseResult(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  result: unknown,
): void {
  const envelope: SseEnvelope = { type: "result", result };
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
}

export function writeSseError(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  error: string,
): void {
  const envelope: SseEnvelope = { type: "error", error };
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
}
