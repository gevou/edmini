/**
 * POST /api/events/push
 * DELETE /api/events/push
 *
 * Client-side write endpoint for the server event log. The voice agent
 * front-end uses this to land voice-loop events (user_spoke, model_speaking,
 * session_started, …) into the server store, where they fan out to every
 * subscribed UI via /api/events/stream.
 *
 * Request body (POST):
 *   { kind: EventLogKind, label: string, detail?: string, payload?: object }
 *
 * Response (POST):
 *   { id: string, timestamp: number }
 *
 * DELETE clears the server store. Used by the EventLogPanel "Clear" button.
 */
import {
  clearServerEvents,
  pushServerEvent,
  type EventLogKind,
} from "@/lib/server-event-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS: ReadonlySet<EventLogKind> = new Set<EventLogKind>([
  "session_started",
  "session_ended",
  "user_spoke",
  "user_paused",
  "user_interrupted",
  "model_speaking",
  "rephrased",
  "classified",
  "clarification_needed",
  "dispatched",
  "awaiting",
  "completed",
  "failed",
  "retried",
  "cancelled",
  "info",
  "error",
]);

function isValidKind(value: unknown): value is EventLogKind {
  return typeof value === "string" && VALID_KINDS.has(value as EventLogKind);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "body must be an object" }, { status: 400 });
  }

  const { kind, label, detail, payload } = body as Record<string, unknown>;

  if (!isValidKind(kind)) {
    return Response.json(
      { error: `invalid kind: ${String(kind)}` },
      { status: 400 },
    );
  }

  if (typeof label !== "string" || label.length === 0) {
    return Response.json(
      { error: "label (non-empty string) required" },
      { status: 400 },
    );
  }

  if (detail !== undefined && typeof detail !== "string") {
    return Response.json(
      { error: "detail must be a string when provided" },
      { status: 400 },
    );
  }

  if (
    payload !== undefined &&
    (typeof payload !== "object" || payload === null || Array.isArray(payload))
  ) {
    return Response.json(
      { error: "payload must be a plain object when provided" },
      { status: 400 },
    );
  }

  const stored = pushServerEvent({
    kind,
    label,
    detail: detail as string | undefined,
    payload: payload as Record<string, unknown> | undefined,
  });

  return Response.json({ id: stored.id, timestamp: stored.timestamp });
}

export async function DELETE() {
  clearServerEvents();
  return Response.json({ cleared: true });
}
