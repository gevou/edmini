import { sleep } from "workflow";
import { callDecideAndExecute, callRephrase, type DecideResult } from "./llm";
import { tavilySearch, sendTelegram } from "./execute";
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
  const decision = await decideAction(rephrased);

  if (!decision.capability) return;

  await recordEvent({
    kind: "dispatched",
    label: `Executing: ${decision.capability}`,
    payload: { actionId, capability: decision.capability, params: decision.params },
  });

  try {
    if (decision.capability === "web_search") {
      const query = decision.params.query as string;
      const results = await tavilySearch(query);
      const summary = results.map((r, i) => `${i + 1}. ${r.title} — ${r.content.slice(0, 120)}`).join("\n");
      await recordEvent({
        kind: "completed",
        label: "Search complete",
        detail: summary.slice(0, 300),
        payload: {
          actionId,
          capability: "web_search",
          summary: `I found ${results.length} results for "${query}": ${results.map((r) => r.title).join(", ")}.`,
        },
      });
    } else if (decision.capability === "send_message") {
      const body = String(decision.params.body ?? "");
      await recordEvent({
        kind: "awaiting",
        label: "Sleeping 60s before Telegram send",
        detail: "Close the tab / end voice now — the workflow keeps running.",
        payload: { actionId, capability: "send_message", durationMs: 60_000 },
      });
      await sleep("60s");
      await sendTelegram(body);
      await recordEvent({
        kind: "completed",
        label: "Telegram sent",
        detail: body.slice(0, 200),
        payload: {
          actionId,
          capability: "send_message",
          summary: `Sent on Telegram: ${body}`,
        },
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordEvent({ kind: "failed", label: "Action failed", detail: msg, payload: { actionId } });
  }
}
