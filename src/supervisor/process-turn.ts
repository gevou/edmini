/**
 * processTurn — the supervisor pipeline for one voice turn.
 *
 * Wired as a Vercel Workflow SDK workflow (Phase 2). Each step inside is a
 * `'use step'` boundary so the runtime can checkpoint, retry, and replay
 * each step independently. The transport emits events between steps; the
 * UI subscribes via the server event log.
 *
 * Current state: rephrase is wired to a real LLM call. decideRoute and
 * action dispatch land in Phase 2.x — see the take-home brief for the plan.
 *
 * The contract (SupervisorRequest in, events out, SupervisorResponse returned)
 * is stable across the noop → real-implementation transition. Callers of this
 * function won't change.
 */
import { callDecideAndExecute, callRephrase, type DecideResult } from "./llm";
import { tavilySearch, sendTelegram } from "./execute";
import type { RephrasedResult, SupervisorRequest, SupervisorResponse, SupervisorTransport } from "./types";

let actionCounter = 0;

export async function processTurn(req: SupervisorRequest, transport: SupervisorTransport): Promise<SupervisorResponse> {
  "use workflow";
  const transcriptPreview = req.transcript.slice(0, 80);

  const rephrased = await rephrase(transcriptPreview);
  transport.emit({
    kind: "rephrased",
    label: "Rephrased",
    detail: rephrased.text,
    payload: { ...rephrased },
  });

  const actionId = `act_${++actionCounter}_${Date.now()}`;

  await decideAndExecute(rephrased, actionId, transport);

  return {
    ack: rephrased.ack,
    actionId,
    decision: {
      kind: "casual" as const,
      rephrase: rephrased,
      ack: rephrased.ack,
    },
  };
}

export async function rephrase(transcript: string): Promise<RephrasedResult> {
  "use step";
  return callRephrase(transcript);
}

export async function decideAndExecute(
  rephrased: RephrasedResult,
  actionId: string,
  transport: SupervisorTransport,
): Promise<DecideResult> {
  "use step";
  const decision = await callDecideAndExecute(rephrased);

  if (!decision.capability) return decision;

  transport.emit({
    kind: "dispatched",
    label: `Executing: ${decision.capability}`,
    payload: { actionId, capability: decision.capability, params: decision.params },
  });

  try {
    if (decision.capability === "web_search") {
      const results = await tavilySearch(decision.params.query as string);
      console.log("[decideAndExecute] tavilySearch returned", results.length, "results");
      const summary = results.map((r, i) => `${i + 1}. ${r.title} — ${r.content.slice(0, 120)}`).join("\n");
      transport.emit({
        kind: "completed",
        label: "Search complete",
        detail: summary.slice(0, 300),
        payload: {
          actionId,
          capability: "web_search",
          summary: `I found ${results.length} results for "${decision.params.query}": ${results.map((r) => r.title).join(", ")}.`,
        },
      });
    } else if (decision.capability === "send_message") {
      const body = String(decision.params.body ?? "");
      await sendTelegram(body);
      console.log("[decideAndExecute] sendTelegram delivered", body.length, "chars");
      transport.emit({
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
    transport.emit({ kind: "failed", label: "Action failed", detail: msg, payload: { actionId } });
  }

  return decision;
}
