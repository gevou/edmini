/**
 * The bus transport — the swappable seam between edmini and the harness. v1 ships one
 * implementation (Discord, see ./discord-transport.ts); A2A / direct-API / CLI transports can
 * implement the same interface later. Transports produce/consume the normalized envelope contract
 * (./envelope.ts): the OUTBOUND side here maps to task_dispatch / answer / cancel.
 * See docs/architecture/edmini-v1-design.md §4.
 */
import type { OutboundEnvelopeKind, EnvelopePayloadMap } from "./envelope";

export interface DispatchResult {
  /** Run identifier — the Discord message id of the dispatch (becomes the thread id once threaded). */
  runId: string;
  messageId: string;
}

export interface BusTransport {
  /** Send a new task to the harness; returns the run handle. (outbound: task_dispatch) */
  dispatch(instruction: string): Promise<DispatchResult>;
  /** Reply to a blocked run's question. (outbound: answer) */
  answer(runId: string, text: string): Promise<void>;
  /** Ask the harness to stop a run; best-effort over chat. (outbound: cancel) */
  cancel(runId: string, reason?: string): Promise<void>;
}

/**
 * Render an outbound envelope to the natural-language text posted on a chat transport. Template-based
 * for v1; LLM polish is a later refinement. (Inbound interpretation is the worker's job — edmini-dze.)
 */
export function renderOutbound<K extends OutboundEnvelopeKind>(
  kind: K,
  payload: EnvelopePayloadMap[K],
): string {
  switch (kind) {
    case "task_dispatch":
      return String((payload as EnvelopePayloadMap["task_dispatch"]).instruction ?? "");
    case "answer":
      return String((payload as EnvelopePayloadMap["answer"]).text ?? "");
    case "cancel": {
      const reason = (payload as EnvelopePayloadMap["cancel"]).reason;
      return "⏹ Please stop the current task" + (reason ? `: ${reason}` : "") + ".";
    }
    default:
      return "";
  }
}
