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
import { callDecideAndExecute, callRephrase, DecideResult } from "./llm";
import { tavilySearch } from "./execute";
import type { RephrasedResult, SupervisorRequest, SupervisorResponse, SupervisorTransport } from "./types";

export async function processTurn(req: SupervisorRequest, transport: SupervisorTransport): Promise<SupervisorResponse> {
  "use workflow";
  const transcriptPreview = req.transcript.slice(0, 80);

  // Step 1 — rephrase: voice transcript → structured intent description.
  const rephrased = await rephrase(transcriptPreview);
  transport.emit({
    kind: "rephrased",
    label: "Rephrased",
    detail: transcriptPreview,
    payload: { ...rephrased },
  });

  void decideAndExecute(rephrased);

  return {
    ack: rephrased.ack,
    actionId: "",
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

export async function decideAndExecute(rephrased: RephrasedResult): Promise<DecideResult> {
  "use step";
  const decision = await callDecideAndExecute(rephrased);

  if (decision.capability === "web_search") {
    const results = await tavilySearch(decision.params.query as string);
    decision.params.results = results;
  }
  console.log(decision.params.results);
  return decision;
}
