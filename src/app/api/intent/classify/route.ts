/**
 * POST /api/intent/classify
 *
 * Receives a transcript from the voice front-end (in response to a Realtime
 * `classify_and_route` tool call) and returns an SSE stream of supervisor
 * events plus a final result envelope.
 *
 * Body shape: { transcript: string, sessionId: string, context?: object }
 *
 * Stream format (one envelope per `data:` line, JSON):
 *   { "type": "event",  "event": SupervisorEvent }
 *   { "type": "result", "result": SupervisorResponse }
 *   { "type": "error",  "error": string }
 *
 * The client (VoiceAgent.handleDataChannelMessage) reads the stream, pushes
 * each event into the EventLogPanel store, and uses the result.ack to drive
 * the Realtime model's next response via conversation.item.create.
 */
import {
  createSseTransport,
  processTurn,
  writeSseError,
  writeSseResult,
  type SupervisorRequest,
} from "@/supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Partial<SupervisorRequest>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.transcript || typeof body.transcript !== "string") {
    return new Response(
      JSON.stringify({ error: "transcript (string) required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const supervisorRequest: SupervisorRequest = {
    transcript: body.transcript,
    sessionId: body.sessionId ?? "anonymous",
    context: body.context,
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const transport = createSseTransport(controller, encoder);
      try {
        const result = await processTurn(supervisorRequest, transport);
        writeSseResult(controller, encoder, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeSseError(controller, encoder, message);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
