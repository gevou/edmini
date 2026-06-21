/**
 * Thread registration (edmini-shd) — service-role write of a conversation-locus row. The browser holds
 * only the anon key; the voice client POSTs here to record its voice thread at session start.
 */
import { threadStoreFromEnv, type ThreadMedium } from "@/lib/threads";
import { mintThreadId } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: { medium?: ThreadMedium; transport?: string; apiIdentifier?: string; runId?: string | null };
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  if (body.medium !== "voice" && body.medium !== "written") return Response.json({ error: "medium must be voice|written" }, { status: 400 });
  if (!body.transport || !body.apiIdentifier) return Response.json({ error: "transport and apiIdentifier required" }, { status: 400 });

  try {
    const threads = threadStoreFromEnv({ serviceRole: true });
    const thread = await threads.insert({
      id: mintThreadId(), medium: body.medium, transport: body.transport,
      apiIdentifier: body.apiIdentifier, runId: body.runId ?? null, topicId: null,
    });
    return Response.json({ threadId: thread.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
