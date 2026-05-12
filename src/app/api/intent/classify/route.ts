/**
 * POST /api/intent/classify
 *
 * Receives a transcript from the voice front-end (in response to a Realtime
 * `classify_and_route` tool call), runs the supervisor pipeline, and returns
 * the SupervisorResponse as JSON. Supervisor events flow OUT through the
 * server event store (see /api/events/stream) — they are no longer streamed
 * back on this response.
 *
 * Request body: { transcript: string, sessionId: string, context?: object }
 * Response: SupervisorResponse { ack, actionId, intent }
 */
import {
  createServerStoreTransport,
  processTurn,
  type SupervisorRequest,
} from "@/supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Partial<SupervisorRequest>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.transcript || typeof body.transcript !== "string") {
    return Response.json(
      { error: "transcript (string) required" },
      { status: 400 },
    );
  }

  const supervisorRequest: SupervisorRequest = {
    transcript: body.transcript,
    sessionId: body.sessionId ?? "anonymous",
    context: body.context,
  };

  const transport = createServerStoreTransport();
  try {
    const result = await processTurn(supervisorRequest, transport);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Also emit the error through the transport so subscribed UIs see it.
    transport.emit({
      kind: "error",
      label: "Supervisor error",
      detail: message,
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
