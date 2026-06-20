/**
 * Narration queue (edmini-9ex) — serialises run updates onto the voice client's single output
 * channel under a priority policy: never interrupt the user, surface blockers/failures first,
 * batch near-simultaneous items into one utterance.
 *
 * Deliberately SOURCE-AGNOSTIC: it knows nothing about runs, the ledger, or React. The run-scoped
 * mapping (ledger event → item) is one producer; a future run-less "invoker" inbound role
 * (email/IoT/webhook) is just a second producer calling enqueue(). Pure and unit-testable.
 * See docs/superpowers/specs/2026-06-19-concurrent-run-narration-design.md §5.2 / §10.
 */

export type Priority = "high" | "low";

export interface NarrationItem {
  /** high = run_blocked/run_failed (needs the user); low = run_output/run_done (informational). */
  priority: Priority;
  kind: string; // ledger kind, for composing/labelling the utterance
  text: string; // human-readable one-liner
  label?: string; // run label when run-scoped; absent for future run-less events
}

export type NarrationBatch = NarrationItem[];

export interface NarrationQueue {
  enqueue(item: NarrationItem): void;
  /** Pop the next batch to speak — all queued `high` items, else all `low` — but only when
   *  `canSpeak` (channel idle: open, user not speaking, no response in flight). Returns null when
   *  gated or empty. Items in the returned batch are removed from the queue. */
  drain(canSpeak: boolean): NarrationBatch | null;
  isEmpty(): boolean;
}

export function createNarrationQueue(): NarrationQueue {
  let items: NarrationItem[] = [];

  return {
    enqueue(item) {
      items.push(item);
    },

    drain(canSpeak) {
      if (!canSpeak || items.length === 0) return null;
      const highs = items.filter((i) => i.priority === "high");
      if (highs.length > 0) {
        items = items.filter((i) => i.priority !== "high");
        return highs;
      }
      const batch = items;
      items = [];
      return batch;
    },

    isEmpty() {
      return items.length === 0;
    },
  };
}
