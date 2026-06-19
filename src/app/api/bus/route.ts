/**
 * Outbound bus API (edmini-fw5) — the voice layer calls this to drive the harness. Maps the three
 * outbound actions to the transport (Discord) and records each as a ledger event (the outbound
 * crossing lands in the ledger before/as it reaches the harness; see edmini-v1-design.md §0/§4).
 *
 * POST body (one of):
 *   { action: "dispatch", instruction }        -> creates a run, returns { runId }
 *   { action: "answer",   runId, text }        -> reply to a blocked run
 *   { action: "cancel",   runId, reason? }     -> stop a run
 */
import { discordTransportFromEnv } from "@/lib/bus/discord-transport";
import { ledgerFromEnv } from "@/lib/ledger-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BusRequest =
  | { action: "dispatch"; instruction: string }
  | { action: "answer"; runId: string; text: string }
  | { action: "cancel"; runId: string; reason?: string };

export async function POST(request: Request): Promise<Response> {
  let body: BusRequest;
  try {
    body = (await request.json()) as BusRequest;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const transport = discordTransportFromEnv();
  const ledger = ledgerFromEnv({ serviceRole: true });

  try {
    switch (body.action) {
      case "dispatch": {
        if (!body.instruction?.trim()) return Response.json({ error: "instruction required" }, { status: 400 });
        const { runId } = await transport.dispatch(body.instruction);
        await ledger.append({ runId, source: "edmini", kind: "task_dispatch", payload: { instruction: body.instruction } });
        return Response.json({ runId });
      }
      case "answer": {
        if (!body.runId || !body.text?.trim()) return Response.json({ error: "runId and text required" }, { status: 400 });
        await transport.answer(body.runId, body.text);
        await ledger.append({ runId: body.runId, source: "edmini", kind: "answer", payload: { text: body.text } });
        return Response.json({ ok: true });
      }
      case "cancel": {
        if (!body.runId) return Response.json({ error: "runId required" }, { status: 400 });
        await transport.cancel(body.runId, body.reason);
        await ledger.append({ runId: body.runId, source: "edmini", kind: "cancel", payload: { reason: body.reason ?? null } });
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
