import { describe, it, expect } from "vitest";
import { fromRow, toInsert, projectRuns, type LedgerEvent, type LedgerRow } from "../ledger";


describe("row mapping", () => {
  it("fromRow maps snake_case → camelCase and defaults null payload", () => {
    const row: LedgerRow = {
      id: "u1",
      seq: 7,
      ts: "2026-06-18T00:00:00Z",
      run_id: "thread-1",
      thread_id: null,
      source: "harness",
      kind: "run_output",
      payload: null,
    };
    expect(fromRow(row)).toEqual({
      id: "u1",
      seq: 7,
      ts: "2026-06-18T00:00:00Z",
      runId: "thread-1",
      threadId: null,
      source: "harness",
      kind: "run_output",
      payload: {},
    });
  });

  it("toInsert keeps only writable columns", () => {
    const e: LedgerEvent = {
      id: "should-drop",
      seq: 99,
      ts: "should-drop",
      runId: "t9",
      source: "edmini",
      kind: "task_dispatch",
      payload: { instruction: "deploy" },
    };
    expect(toInsert(e)).toEqual({
      run_id: "t9",
      thread_id: null,
      source: "edmini",
      kind: "task_dispatch",
      payload: { instruction: "deploy" },
    });
  });
});

describe("projectRuns", () => {
  const ev = (seq: number, runId: string | null, kind: string): LedgerEvent => ({
    seq,
    ts: `2026-06-18T00:00:${String(seq).padStart(2, "0")}Z`,
    runId,
    source: "harness",
    kind,
    payload: {},
  });

  it("derives latest lifecycle kind by seq, ignoring non-run kinds", () => {
    const events = [
      ev(1, "A", "run_started"),
      ev(2, "A", "info"), // non-lifecycle, ignored for lastRunKind
      ev(3, "A", "run_blocked"),
      ev(4, "A", "run_output"),
    ];
    const [a] = projectRuns(events);
    expect(a.runId).toBe("A");
    expect(a.lastRunKind).toBe("run_output");
    expect(a.eventCount).toBe(4);
    expect(a.outputCount).toBe(1);
    expect(a.startedAt).toBe("2026-06-18T00:00:01Z");
    expect(a.lastActivity).toBe("2026-06-18T00:00:04Z");
  });

  it("is order-independent (sorts by seq)", () => {
    const shuffled = [ev(3, "A", "run_done"), ev(1, "A", "run_started"), ev(2, "A", "run_output")];
    const [a] = projectRuns(shuffled);
    expect(a.lastRunKind).toBe("run_done");
    expect(a.outputCount).toBe(1);
  });

  it("separates runs and skips events with no runId", () => {
    const events = [
      ev(1, "A", "run_started"),
      ev(2, null, "info"),
      ev(3, "B", "run_failed"),
    ];
    const runs = projectRuns(events).sort((x, y) => x.runId.localeCompare(y.runId));
    expect(runs.map((r) => r.runId)).toEqual(["A", "B"]);
    expect(runs[1].lastRunKind).toBe("run_failed");
  });
});

describe("ledger threadId mapping", () => {
  it("maps thread_id <-> threadId in fromRow/toInsert", () => {
    const row = { id: "e1", seq: 1, ts: "t", run_id: "run_1", thread_id: "thr_1",
      source: "harness" as const, kind: "run_output", payload: {} };
    expect(fromRow(row).threadId).toBe("thr_1");
    expect(toInsert({ runId: "run_1", threadId: "thr_1", source: "harness", kind: "x", payload: {} }))
      .toMatchObject({ run_id: "run_1", thread_id: "thr_1" });
  });
  it("defaults threadId to null", () => {
    const row = { id: "e1", seq: 1, ts: "t", run_id: null, thread_id: null,
      source: "user" as const, kind: "x", payload: {} };
    expect(fromRow(row).threadId).toBeNull();
  });
});
