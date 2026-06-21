import { describe, it, expect, vi } from "vitest";
import { createRunResolver } from "../resolve-run";
import type { ThreadStore, ThreadRecord } from "../../src/lib/threads";

const thr = (over: Partial<ThreadRecord>): ThreadRecord => ({
  id: "thr_1", medium: "written", transport: "discord", apiIdentifier: "T1", runId: "run_1", topicId: null, ...over,
});

function store(map: Record<string, ThreadRecord | null>): ThreadStore {
  return {
    insert: vi.fn(),
    byRunId: vi.fn(),
    byApiIdentifier: vi.fn(async (_t, a) => map[a] ?? null),
  };
}

describe("worker run resolver", () => {
  it("resolves api_identifier -> {threadId, runId} and caches (one query)", async () => {
    const s = store({ T1: thr({}) });
    const r = createRunResolver({ store: s, transport: "discord", retries: 0, sleep: async () => {} });
    expect(await r.resolve("T1")).toEqual({ threadId: "thr_1", runId: "run_1" });
    expect(await r.resolve("T1")).toEqual({ threadId: "thr_1", runId: "run_1" });
    expect(s.byApiIdentifier).toHaveBeenCalledTimes(1);
  });

  it("retries on miss, then succeeds (race window)", async () => {
    let calls = 0;
    const s: ThreadStore = { insert: vi.fn(), byRunId: vi.fn(),
      byApiIdentifier: vi.fn(async () => (++calls >= 2 ? thr({}) : null)) };
    const r = createRunResolver({ store: s, transport: "discord", retries: 3, sleep: async () => {} });
    expect(await r.resolve("T1")).toEqual({ threadId: "thr_1", runId: "run_1" });
    expect(calls).toBe(2);
  });

  it("legacy fallback after retries exhausted: api_identifier == runId", async () => {
    const s = store({});
    const r = createRunResolver({ store: s, transport: "discord", retries: 1, sleep: async () => {} });
    expect(await r.resolve("999")).toEqual({ threadId: "999", runId: "999" });
  });
});
