/**
 * Append-only accountability ledger — the system of record (Supabase/Postgres).
 * See docs/architecture/edmini-v1-design.md §5 and infra/supabase/migrations/0001_ledger.sql.
 *
 * This module is the dependency-free, unit-testable HEART of the ledger: the event/row types,
 * row mapping, and the `projectRuns` projection (which mirrors the SQL `runs` view). The thin
 * Supabase client binding (appendEvent / snapshot / subscribe over @supabase/supabase-js) is
 * added at integration time (beads edmini-yak) — it needs a live DB to test and is gated on
 * provisioning, so it is deliberately kept out of this pure core.
 */

export type LedgerSource = "user" | "edmini" | "harness";

/** Run lifecycle kinds that carry a run's state (subset of envelope kinds). */
export const RUN_LIFECYCLE_KINDS = [
  "run_started",
  "run_blocked",
  "run_output",
  "run_done",
  "run_failed",
] as const;

export interface LedgerEvent {
  id?: string;
  seq?: number;
  ts?: string; // ISO timestamptz
  runId: string | null; // Discord thread snowflake (null for pre-run/system events)
  source: LedgerSource;
  kind: string; // an envelope kind or a UI event kind
  payload: Record<string, unknown>;
}

/** DB row shape — snake_case columns from 0001_ledger.sql. */
export interface LedgerRow {
  id: string;
  seq: number;
  ts: string;
  run_id: string | null;
  source: LedgerSource;
  kind: string;
  payload: Record<string, unknown> | null;
}

export function fromRow(r: LedgerRow): LedgerEvent {
  return {
    id: r.id,
    seq: r.seq,
    ts: r.ts,
    runId: r.run_id,
    source: r.source,
    kind: r.kind,
    payload: r.payload ?? {},
  };
}

/** Writable columns for an insert — the DB fills id/seq/ts. */
export function toInsert(e: LedgerEvent): Pick<LedgerRow, "run_id" | "source" | "kind" | "payload"> {
  return { run_id: e.runId, source: e.source, kind: e.kind, payload: e.payload ?? {} };
}

/** Current lifecycle state of a run, derived from its events. Mirrors the SQL `runs` view. */
export interface RunState {
  runId: string;
  lastRunKind: string | null; // latest run_* kind seen
  startedAt: string | null;
  lastActivity: string | null;
  eventCount: number;
  outputCount: number;
}

const RUN_KIND_SET: ReadonlySet<string> = new Set(RUN_LIFECYCLE_KINDS);

/**
 * Project a flat event stream into per-run lifecycle state. Pure: deterministic, no I/O.
 * Events are grouped by runId and ordered by `seq` so "latest" is unambiguous.
 */
export function projectRuns(events: LedgerEvent[]): RunState[] {
  const byRun = new Map<string, LedgerEvent[]>();
  for (const e of events) {
    if (!e.runId) continue;
    let arr = byRun.get(e.runId);
    if (!arr) {
      arr = [];
      byRun.set(e.runId, arr);
    }
    arr.push(e);
  }

  const out: RunState[] = [];
  for (const [runId, evs] of byRun) {
    const sorted = [...evs].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const lifecycle = sorted.filter((e) => RUN_KIND_SET.has(e.kind));
    const tss = sorted.map((e) => e.ts).filter((t): t is string => Boolean(t));
    out.push({
      runId,
      lastRunKind: lifecycle.length ? lifecycle[lifecycle.length - 1].kind : null,
      startedAt: tss.length ? tss[0] : null,
      lastActivity: tss.length ? tss[tss.length - 1] : null,
      eventCount: sorted.length,
      outputCount: sorted.filter((e) => e.kind === "run_output").length,
    });
  }
  return out;
}
