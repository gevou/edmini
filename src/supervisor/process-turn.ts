/**
 * Noop implementation of `processTurn`.
 *
 * Wired end-to-end through the transport, so the front-end's event log fills
 * in with a believable sequence of events. The actual logic (rephrase via LLM,
 * classify, route, dispatch external actions) is not implemented yet.
 *
 * To replace with the real implementation:
 *   - Wrap this in a Workflow SDK 'use workflow' function (Phase 2)
 *   - Each emit() call becomes a checkpointed 'use step' boundary
 *   - Replace the staggered sleeps with real LLM / tool calls
 *
 * The contract (SupervisorRequest in, events out, SupervisorResponse returned)
 * stays the same. Callers of this function won't change.
 */
import type {
  SupervisorRequest,
  SupervisorResponse,
  SupervisorTransport,
} from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let actionCounter = 0;

export async function processTurn(
  req: SupervisorRequest,
  transport: SupervisorTransport,
): Promise<SupervisorResponse> {
  const startedAt = Date.now();
  const transcriptPreview = req.transcript.slice(0, 80);

  // Step 1 — rephrase voice → structured intent description (noop)
  transport.emit({
    kind: "rephrased",
    label: "Rephrased (noop)",
    detail: transcriptPreview,
  });
  await sleep(180);

  // Step 2 — classify intent (noop returns "noop" with full confidence)
  transport.emit({
    kind: "classified",
    label: "Intent: noop",
    payload: {
      action: "noop",
      confidence: 1.0,
      transcript: transcriptPreview,
    },
  });
  await sleep(120);

  // Step 3 — dispatch (noop emits a fake action id and pretends to await an
  // external system before completing)
  const actionId = `act_noop_${++actionCounter}_${startedAt}`;
  transport.emit({
    kind: "dispatched",
    label: "Dispatched: noop",
    payload: { actionId },
  });
  await sleep(150);

  transport.emit({
    kind: "awaiting",
    label: "Awaiting external system (noop)",
    detail: "no real call — sleep(220) standing in",
  });
  await sleep(220);

  transport.emit({
    kind: "completed",
    label: "Completed: noop",
    payload: {
      actionId,
      took_ms: Date.now() - startedAt,
    },
  });

  return {
    ack: `Noop supervisor: I heard "${transcriptPreview}". Real handler not wired yet.`,
    actionId,
    intent: {
      type: "noop",
      confidence: 1.0,
      params: { transcript: req.transcript, sessionId: req.sessionId },
    },
  };
}
