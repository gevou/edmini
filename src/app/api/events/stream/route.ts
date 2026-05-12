/**
 * GET /api/events/stream
 *
 * Long-lived Server-Sent Events endpoint that emits the server event log to
 * any subscribed client. On connect, sends a one-shot snapshot envelope so
 * the new subscriber catches up on history, then streams future events as
 * they're pushed into the server store.
 *
 * Envelope format (one per `data:` line, JSON):
 *   { "type": "snapshot", "entries": EventLogEntry[] }
 *   { "type": "event",    "entry":   EventLogEntry   }
 *   { "type": "cleared" }
 *
 * Both the voice agent UI and the dashboard subscribe to this stream — the
 * server is the single source of truth, every UI is a subscriber.
 */
import {
  getServerEntriesSnapshot,
  subscribeServer,
  subscribeServerClear,
  type EventLogEntry,
} from "@/lib/server-event-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StreamEnvelope =
  | { type: "snapshot"; entries: readonly EventLogEntry[] }
  | { type: "event"; entry: EventLogEntry }
  | { type: "cleared" };

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const safeEnqueue = (envelope: StreamEnvelope) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`),
          );
        } catch {
          // controller may have been closed underneath us; flip the flag so
          // subsequent fan-out calls become no-ops
          closed = true;
        }
      };

      // 1. Snapshot — catch new subscribers up on existing entries.
      safeEnqueue({ type: "snapshot", entries: getServerEntriesSnapshot() });

      // 2. Subscribe to future events + clears.
      const unsubscribeEvent = subscribeServer((entry) => {
        safeEnqueue({ type: "event", entry });
      });
      const unsubscribeClear = subscribeServerClear(() => {
        safeEnqueue({ type: "cleared" });
      });

      // 3. Heartbeat — keep the connection alive through proxies that
      //    aggressively close idle streams (Vercel, nginx, etc.). 15s is a
      //    common floor.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          closed = true;
        }
      }, 15_000);

      // 4. Tear down when the client disconnects.
      const onAbort = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribeEvent();
        unsubscribeClear();
        try {
          controller.close();
        } catch {
          // already closed — fine
        }
      };
      request.signal.addEventListener("abort", onAbort);
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
