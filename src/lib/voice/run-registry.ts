import { projectRuns, type LedgerEvent } from "../ledger";

/**
 * Run registry (edmini-9ex) — the voice client's label↔runId map for supervising N concurrent runs.
 *
 * The model addresses runs by short human-friendly labels (e.g. "export", "research"); raw runIds
 * (Discord thread snowflakes) stay internal. This registry is a cache/projection over the ledger
 * (labels are persisted in the `task_dispatch` payload), mirroring how `projectRuns` in ./ledger.ts
 * relates to the `events` table. Pure and dependency-free — unit-testable without React or I/O.
 * See docs/superpowers/specs/2026-06-19-concurrent-run-narration-design.md §5.1.
 */

export type RunStatus = "active" | "blocked" | "done" | "failed";

export interface RunRegistry {
  /** Record a run under a label. Applies the collision-suffix rule; returns the CANONICAL label
   *  actually stored (the caller re-syncs to it). Idempotent for an already-registered runId. */
  register(runId: string, requestedLabel: string): string;
  /** runId for a label, or null. */
  resolveLabel(label: string): string | null;
  /** label for a runId, or null. */
  labelFor(runId: string): string | null;
  /** Update a run's lifecycle status (no-op for an unknown run). */
  setStatus(runId: string, status: RunStatus): void;
  /** Forget a run (frees its label for reuse). */
  remove(runId: string): void;
  has(runId: string): boolean;
}

interface Entry {
  label: string;
  status: RunStatus;
}

export function createRunRegistry(): RunRegistry {
  const byRun = new Map<string, Entry>();
  const byLabel = new Map<string, string>(); // label -> runId

  /** Find a free label: `base`, else `base-2`, `base-3`, … */
  function uniqueLabel(base: string): string {
    if (!byLabel.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!byLabel.has(candidate)) return candidate;
    }
  }

  return {
    register(runId, requestedLabel) {
      const existing = byRun.get(runId);
      if (existing) return existing.label; // idempotent
      const base = requestedLabel.trim() || "task";
      const label = uniqueLabel(base);
      byRun.set(runId, { label, status: "active" });
      byLabel.set(label, runId);
      return label;
    },

    resolveLabel(label) {
      return byLabel.get(label) ?? null;
    },

    labelFor(runId) {
      return byRun.get(runId)?.label ?? null;
    },

    setStatus(runId, status) {
      const entry = byRun.get(runId);
      if (entry) entry.status = status;
    },

    remove(runId) {
      const entry = byRun.get(runId);
      if (!entry) return;
      byRun.delete(runId);
      byLabel.delete(entry.label);
    },

    has(runId) {
      return byRun.has(runId);
    },
  };
}

/**
 * Rebuild a registry from a ledger snapshot (edmini-iee §1). Pure: replays every `task_dispatch`
 * in seq order through the existing `register` (collision-suffix rule unchanged), then applies each
 * run's status from projectRuns. This is what makes cross-session/pre-reload runs resolve a label so
 * handleLedgerEvent no longer drops their events.
 */
export function buildRegistryFromEvents(events: LedgerEvent[]): RunRegistry {
  const registry = createRunRegistry();
  const dispatches = events
    .filter((e) => e.kind === "task_dispatch" && e.runId)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const e of dispatches) {
    const label = typeof e.payload.label === "string" ? e.payload.label : "";
    registry.register(e.runId as string, label);
  }
  for (const r of projectRuns(events)) {
    const status: RunStatus =
      r.lastRunKind === "run_failed" ? "failed"
        : r.lastRunKind === "run_done" ? "done"
          : r.lastRunKind === "run_blocked" ? "blocked"
            : "active";
    registry.setStatus(r.runId, status);
  }
  return registry;
}
