/**
 * History retrieval (edmini-iee §3b) — backs the `search_history` voice tool. A THIN parametric query
 * over the ledger: no ranking, no summarization. Its INTERFACE is durable into the graph era; only the
 * backend swaps (ledger snapshot → graph retrieval) behind this same route. `to`/addressivity is
 * deferred to edmini-qo3 (the param shape is reserved, not implemented).
 */
import { ledgerFromEnv } from "@/lib/ledger-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HistoryParams {
  limit?: number; runId?: string; apiIdentifier?: string;
  since?: string; until?: string; text?: string;
  source?: "user" | "edmini" | "harness"; author?: string; channel?: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: HistoryParams;
  try { body = (await request.json()) as HistoryParams; }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  const limit = Math.min(100, Math.max(1, typeof body.limit === "number" ? body.limit : 30));

  const opts: Record<string, unknown> = { limit };
  if (typeof body.runId === "string") opts.runId = body.runId;
  if (typeof body.since === "string") opts.since = body.since;
  if (typeof body.until === "string") opts.until = body.until;
  if (typeof body.text === "string" && body.text.trim()) opts.text = body.text.trim();
  if (body.source === "user" || body.source === "edmini" || body.source === "harness") opts.source = body.source;
  if (typeof body.author === "string") opts.author = body.author;
  // channel filter: pending thread-store query (resolve channel → threadIds). `to` is out of scope (qo3).

  try {
    const ledger = ledgerFromEnv({ serviceRole: true });
    const events = await ledger.snapshot(opts);
    // Diagnostic (edmini-iee): what the model searched and how many it got back. Lets us see, from the
    // Vercel runtime logs, whether a miss is a too-narrow query vs an ordering/limit problem.
    console.log(`[history] params=${JSON.stringify(body)} opts=${JSON.stringify(opts)} returned=${events.length}`);
    return Response.json({ events });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
