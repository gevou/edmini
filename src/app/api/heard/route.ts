/**
 * Heard-event tap (edmini-5y7) — records an utterance edmini HEARD but suppressed (not the enrolled
 * user). The conversational-presence "capture" rail: ambient input becomes a durable ledger event so
 * decide-later promotion is a re-interpretation over the ledger, not lost state. Service-role write
 * (browser holds only the anon key); mirrors /api/voice-output.
 */
import { ledgerFromEnv } from "@/lib/ledger-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: { text?: string; confidence?: number; threadId?: string | null };
  try { body = (await request.json()) as typeof body; }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  try {
    const ledger = ledgerFromEnv({ serviceRole: true });
    await ledger.append({
      runId: null,
      threadId: body.threadId ?? null,
      source: "user",
      kind: "heard",
      payload: { text: body.text ?? null, confidence: body.confidence ?? null },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
