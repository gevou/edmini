import { getServerEntriesSnapshot } from "@/lib/server-event-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ entries: getServerEntriesSnapshot() });
}
