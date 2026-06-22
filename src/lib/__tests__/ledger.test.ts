import { describe, it, expect } from "vitest";
import { fromRow, toInsert, projectRuns, labelsByRun, recentConversation, selectCatchUp, type LedgerEvent, type LedgerRow } from "../ledger";


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

const ev = (seq: number, kind: string, partial: Partial<LedgerEvent> = {}): LedgerEvent => ({
  seq, runId: null, source: "harness", kind, payload: {}, ...partial,
});

describe("labelsByRun", () => {
  it("maps runId to its task_dispatch label", () => {
    const m = labelsByRun([
      ev(1, "task_dispatch", { runId: "run_a", source: "edmini", payload: { label: "export" } }),
      ev(2, "task_dispatch", { runId: "run_b", source: "edmini", payload: { label: "research" } }),
    ]);
    expect(m.get("run_a")).toBe("export");
    expect(m.get("run_b")).toBe("research");
  });
});

describe("recentConversation", () => {
  it("returns the last n user/edmini conversation events oldest-first", () => {
    const events: LedgerEvent[] = [
      ev(1, "user_utterance", { source: "user", payload: { text: "hi" } }),
      ev(2, "run_output", { runId: "run_a" }), // not conversation
      ev(3, "voice_output", { source: "edmini", payload: { text: "hello" } }),
      ev(4, "user_utterance", { source: "user", payload: { text: "do x" } }),
    ];
    const out = recentConversation(events, 2);
    expect(out.map((e) => e.seq)).toEqual([3, 4]);
  });
});

describe("selectCatchUp", () => {
  it("returns narratable harness events past lastSeenSeq for known runs only", () => {
    const known = new Set(["run_a"]);
    const events: LedgerEvent[] = [
      ev(5, "run_output", { runId: "run_a" }),  // <= lastSeen, excluded
      ev(7, "run_done", { runId: "run_a" }),     // included
      ev(8, "run_failed", { runId: "run_b" }),   // unknown run, excluded
      ev(9, "voice_output", { runId: "run_a", source: "edmini" }), // not narratable kind
    ];
    const out = selectCatchUp(events, 6, known);
    expect(out.map((e) => e.seq)).toEqual([7]);
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
