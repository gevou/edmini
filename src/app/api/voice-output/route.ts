/**
 * Voice-output ledger tap (edmini-rv9) — records the **edmini → User** boundary crossing.
 *
 * Ed's spoken responses (the Realtime `response.output_audio_transcript.done` transcript) otherwise
 * live only in the browser's turns UI. Per the §0 accountability design ("the ledger is the system
 * of record; nothing the system produced silently disappears"), each finalized utterance is logged
 * here as a `voice_output` event. Written server-side with the service-role key (the browser holds
 * only the anon key). See docs/architecture/edmini-v1-design.md §5.
 *
 * POST body: { text: string, runId?: string | null }
 */
import { ledgerFromEnv } from "@/lib/ledger-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: { text?: string; runId?: string | null };
  try {
    body = (await request.json()) as { text?: string; runId?: string | null };
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) return Response.json({ error: "text required" }, { status: 400 });

  try {
    const ledger = ledgerFromEnv({ serviceRole: true });
    await ledger.append({
      runId: body.runId ?? null,
      source: "edmini",
      kind: "voice_output",
      payload: { text },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
