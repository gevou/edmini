/**
 * Noop implementation of `cancelAction`.
 *
 * The voice front-end calls this when the Realtime model fires the
 * `cancel_pending_action` tool (e.g. user said "wait, change that to Wednesday"
 * mid-flight). Today we just emit a `cancelled` event and return.
 *
 * Real implementation will:
 *   - Look up the in-flight workflow by actionId
 *   - Call Workflow SDK's cancellation primitive
 *   - Optionally fire a compensation step (rollback partial side effects)
 *
 * This is one of the rough-edge probes for the Pranay writeup: how does
 * Workflow SDK actually handle cancellation of an in-flight 'use step'?
 */
import type { CancelRequest, SupervisorTransport } from "./types";

export async function cancelAction(
  req: CancelRequest,
  transport: SupervisorTransport,
): Promise<void> {
  transport.emit({
    kind: "cancelled",
    label: `Cancelled: ${req.actionId}`,
    detail: req.reason,
    payload: { actionId: req.actionId, reason: req.reason },
  });
}
