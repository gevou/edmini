/**
 * User-utterance ledger tap (edmini-iee §4) — records the **User → edmini** boundary crossing.
 *
 * The ledger has Ed's side (voice_output) and run events but never the User's spoken turns (they live
 * only in /tmp topic state). Logging each finalized User transcript here completes the conversation
 * record (feeds the dumb "Recent history" block) and creates the message nodes the graph will use.
 * Service-role write, fire-and-forget from the client (mirrors /api/voice-output).
 *
 * POST body: { text: string, threadId?: string | null }
 */
import { ledgerFromEnv } from "@/lib/ledger-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: { text?: string; threadId?: string | null };
  try {
    body = (await request.json()) as { text?: string; threadId?: string | null };
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) return Response.json({ error: "text required" }, { status: 400 });

  try {
    const ledger = ledgerFromEnv({ serviceRole: true });
    await ledger.append({
      runId: null,
      threadId: body.threadId ?? null,
      source: "user",
      kind: "user_utterance",
      payload: { text },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
