import { callDecideAndExecute, callRephrase, type DecideResult } from "./llm";
import { pushServerEvent, type EventLogEntry } from "@/lib/server-event-log";
import type { RephrasedResult } from "./types";

type StepEvent = Omit<EventLogEntry, "id" | "timestamp">;

async function recordEvent(event: StepEvent): Promise<void> {
  "use step";
  pushServerEvent(event);
}

export async function rephrase(transcript: string): Promise<RephrasedResult> {
  "use step";
  return callRephrase(transcript);
}

export async function decideAction(rephrased: RephrasedResult): Promise<DecideResult> {
  "use step";
  return callDecideAndExecute(rephrased);
}

export async function processAction(
  rephrased: RephrasedResult,
  actionId: string,
): Promise<void> {
  "use workflow";
  // v1: edmini does NOT execute. It classifies intent and delegates execution to the harness
  // over the bus (Discord). This records the intent; actual dispatch lands with the transport +
  // envelope wiring (beads edmini-n12 / edmini-fw5). See docs/architecture/edmini-v1-design.md.
  const decision = await decideAction(rephrased);
  await recordEvent({
    kind: "dispatched",
    label: decision.capability ? `Would delegate: ${decision.capability}` : "No external action",
    detail: "edmini delegates execution to the harness — no built-in execution in v1.",
    payload: {
      actionId,
      capability: decision.capability ?? null,
      params: decision.params ?? {},
    },
  });
}
