import { start } from "workflow/api";
import {
  createServerStoreTransport,
  rephrase,
  processAction,
  type SupervisorRequest,
} from "@/supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let actionCounter = 0;

export async function POST(request: Request) {
  let body: Partial<SupervisorRequest>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.transcript || typeof body.transcript !== "string") {
    return Response.json(
      { error: "transcript (string) required" },
      { status: 400 },
    );
  }

  const transcriptPreview = body.transcript.slice(0, 80);

  try {
    const rephrased = await rephrase(transcriptPreview);

    const transport = createServerStoreTransport();
    transport.emit({
      kind: "rephrased",
      label: "Rephrased",
      detail: rephrased.text,
      payload: { ...rephrased },
    });

    const actionId = `act_${++actionCounter}_${Date.now()}`;

    await start(processAction, [rephrased, actionId]);

    return Response.json({
      ack: rephrased.ack,
      actionId,
      decision: {
        kind: "casual" as const,
        rephrase: rephrased,
        ack: rephrased.ack,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    createServerStoreTransport().emit({
      kind: "error",
      label: "Supervisor error",
      detail: message,
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
