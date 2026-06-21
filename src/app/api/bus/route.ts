/**
 * Outbound bus API. The voice layer calls this to drive the harness. /api/bus owns identity
 * (edmini-shd): it mints run_/thr_ ids, writes the threads row (our id <-> Discord handle), and
 * records each outbound crossing in the ledger. The transport speaks api_identifier only.
 */
import { discordTransportFromEnv } from "@/lib/bus/discord-transport";
import { ledgerFromEnv } from "@/lib/ledger-supabase";
import { threadStoreFromEnv } from "@/lib/threads";
import { mintRunId, mintThreadId } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BusRequest =
  | { action: "dispatch"; instruction: string; label?: string; prevRunId?: string | null }
  | { action: "answer"; runId: string; text: string }
  | { action: "cancel"; runId: string; reason?: string };

const TRANSPORT = "discord";

export async function POST(request: Request): Promise<Response> {
  let body: BusRequest;
  try { body = (await request.json()) as BusRequest; }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  const transport = discordTransportFromEnv();
  const ledger = ledgerFromEnv({ serviceRole: true });
  const threads = threadStoreFromEnv({ serviceRole: true });

  try {
    switch (body.action) {
      case "dispatch": {
        if (!body.instruction?.trim()) return Response.json({ error: "instruction required" }, { status: 400 });
        const runId = mintRunId();
        const threadId = mintThreadId();
        const { apiIdentifier, messageApiId } = await transport.dispatch(body.instruction);
        await threads.insert({
          id: threadId, medium: "written", transport: TRANSPORT,
          apiIdentifier, runId, topicId: null,
        });
        await ledger.append({
          runId, threadId, source: "edmini", kind: "task_dispatch",
          payload: { instruction: body.instruction, label: body.label ?? null,
                     prevRunId: body.prevRunId ?? null, apiIdentifier: messageApiId },
        });
        return Response.json({ runId });
      }
      case "answer": {
        if (!body.runId || !body.text?.trim()) return Response.json({ error: "runId and text required" }, { status: 400 });
        const thr = await threads.byRunId(body.runId);
        const apiId = thr?.apiIdentifier ?? body.runId; // legacy fallback: pre-shd runId IS the snowflake
        await transport.answer(apiId, body.text);
        await ledger.append({ runId: body.runId, threadId: thr?.id ?? null, source: "edmini", kind: "answer", payload: { text: body.text } });
        return Response.json({ ok: true });
      }
      case "cancel": {
        if (!body.runId) return Response.json({ error: "runId required" }, { status: 400 });
        const thr = await threads.byRunId(body.runId);
        const apiId = thr?.apiIdentifier ?? body.runId; // legacy fallback: pre-shd runId IS the snowflake
        await transport.cancel(apiId, body.reason);
        await ledger.append({ runId: body.runId, threadId: thr?.id ?? null, source: "edmini", kind: "cancel", payload: { reason: body.reason ?? null } });
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}