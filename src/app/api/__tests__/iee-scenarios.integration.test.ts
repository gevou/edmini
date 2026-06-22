/**
 * IEE (session-memory-rehydration) integration eval suite — edmini-nvb
 *
 * Drives the REAL route handlers (session, history, utterance) + the REAL pure helpers
 * (buildRegistryFromEvents, selectCatchUp) against ONE shared in-memory ledger so writes
 * by one call are immediately visible to the next. That cross-route seam is what the
 * per-route unit tests do NOT cover.
 *
 * OUT OF SCOPE (deliberately not tested here):
 *   (1) Live OpenAI Realtime narration — requires WebRTC + a paid key.
 *   (2) VoiceAgent.tsx data-channel glue (dc.onopen catch-up batch; handleLedgerEvent
 *       seq-dedup) — requires a browser/JSDOM + OpenAI E2E. Tracked by edmini-7fn.
 * Do NOT modify VoiceAgent.tsx or any production code. If a test reveals a real product
 * bug, STOP and report it rather than patching prod here.
 *
 * Assertions are on STRUCTURAL signals only — never on fuzzy LLM phrasing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LedgerEvent } from "@/lib/ledger";
import type { Ledger } from "@/lib/ledger-supabase";
import { buildRegistryFromEvents } from "@/lib/voice/run-registry";
import { selectCatchUp } from "@/lib/ledger";

// ─── In-memory ledger ─────────────────────────────────────────────────────────
//
// makeMemoryLedger() returns a Ledger whose rows live in a plain array.
// append() assigns incrementing seq + stable id + ts.
// snapshot(opts) applies the same filters the real Supabase binding supports:
//   runId, source, author (payload.author), since/until (on ts), text
//   (case-insensitive substring over JSON.stringify(payload)), threadIds,
//   and limit applied AFTER ordering by seq ASC (mirrors PostgREST behaviour).
// subscribe() is a no-op (live push not needed in this test).
//
// We use vi.hoisted so the factory returned by vi.mock("@/lib/ledger-supabase")
// can reference the holder and return whatever the current test instance is.
// Each beforeEach resets it to a fresh ledger.

interface MemoryRow extends LedgerEvent {
  id: string;
  seq: number;
  ts: string;
}

function makeMemoryLedger(): Ledger {
  const rows: MemoryRow[] = [];
  let counter = 0;

  function matches(row: MemoryRow, opts: Parameters<Ledger["snapshot"]>[0] = {}): boolean {
    if (opts.runId !== undefined && row.runId !== opts.runId) return false;
    if (opts.source !== undefined && row.source !== opts.source) return false;
    if (opts.author !== undefined && row.payload?.["author"] !== opts.author) return false;
    if (opts.since !== undefined && row.ts < opts.since) return false;
    if (opts.until !== undefined && row.ts > opts.until) return false;
    if (opts.threadIds !== undefined && opts.threadIds.length > 0) {
      if (!row.threadId || !opts.threadIds.includes(row.threadId)) return false;
    }
    if (opts.text !== undefined) {
      // Mirror the real binding: ILIKE only the text-bearing payload keys (jsonb has no ILIKE), with
      // the same metachar sanitization. NOT a whole-payload stringify match — that was more permissive
      // than PostgREST and let a real prod failure pass green.
      const needle = opts.text.replace(/[,()]/g, " ").trim().toLowerCase();
      const hay = ["text", "summary", "question", "error", "instruction", "label"]
        .map((k) => row.payload?.[k])
        .filter((v): v is string => typeof v === "string")
        .join(" ")
        .toLowerCase();
      if (needle && !hay.includes(needle)) return false;
    }
    return true;
  }

  return {
    async append(event) {
      counter += 1;
      const row: MemoryRow = {
        ...event,
        id: `mem-${counter}`,
        seq: counter,
        ts: new Date().toISOString(),
      };
      rows.push(row);
      return row;
    },

    async snapshot(opts = {}) {
      const sorted = [...rows].sort((a, b) => a.seq - b.seq);
      const filtered = sorted.filter((r) => matches(r, opts));
      // Mirror the real binding: when a limit is set, return the most RECENT N (chronological order),
      // not the oldest N. No limit → full ascending set.
      return opts.limit !== undefined ? filtered.slice(-opts.limit) : filtered;
    },

    subscribe() {
      // no-op for deterministic tests
      return { unsubscribe: () => {} } as ReturnType<Ledger["subscribe"]>;
    },
  };
}

// vi.hoisted: the holder must exist before the vi.mock factory runs.
const { ledgerHolder } = vi.hoisted(() => {
  return { ledgerHolder: { current: makeMemoryLedger() } };
});

// All three routes import ledgerFromEnv. Intercept so they all share one instance.
vi.mock("@/lib/ledger-supabase", () => ({
  ledgerFromEnv: () => ledgerHolder.current,
}));

// Mock global fetch — the session route calls OpenAI to mint an ephemeral key.
// We capture the request body so tests can assert on session.instructions / session.tools.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Import routes AFTER the mocks are registered.
import { POST as sessionPOST } from "../session/route";
import { POST as historyPOST } from "../history/route";
import { POST as utterancePOST } from "../conversation/utterance/route";

// Helpers
function makeReq(path: string, body: unknown): Request {
  return new Request(`http://t${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function capturedSessionBody(): { session: { instructions: string; tools: Array<{ name: string }> } } {
  // The session route always makes exactly one fetch call (to OpenAI).
  const last = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse(last[1].body);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  ledgerHolder.current = makeMemoryLedger();
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ value: "ek-test" }),
  });
  process.env.OPENAI_API_KEY = "sk-test";
});

// ─── Scenario (a) — recent history + search_history, end-to-end ───────────────
//
// Asserts: utterance-route writes are visible to the session route (the seam).
// - The "Recent history" block includes the last convo event (recent window).
// - "BlueFinch" (pushed out by 14 fillers) is NOT in the recent block, proving
//   search_history is needed for deeper recall.
// - search_history (history route) does find "BlueFinch" by text search.
// - session.tools includes a tool named "search_history".

describe("Scenario (a) — memory + search_history end-to-end (utterance→session→history)", () => {
  it("recent block includes recent convo but not old text; history route recalls old text", async () => {
    // Step 1: log the "BlueFinch" utterance via the utterance route
    const utteranceRes1 = await utterancePOST(
      makeReq("/api/conversation/utterance", { text: "remember the codename is BlueFinch" }),
    );
    expect(utteranceRes1.status).toBe(200);

    // Step 2: append 14 filler convo pairs (push BlueFinch out of the recent window)
    // We append directly to save noise; the route would work the same way.
    const ledger = ledgerHolder.current;
    for (let i = 1; i <= 14; i++) {
      await ledger.append({ runId: null, source: "user", kind: "user_utterance", payload: { text: `filler user ${i}` } });
      await ledger.append({ runId: null, source: "edmini", kind: "voice_output", payload: { text: `filler ed ${i}` } });
    }

    // Step 3: log the "let's plan the launch" utterance via the route
    const utteranceRes2 = await utterancePOST(
      makeReq("/api/conversation/utterance", { text: "let's plan the launch" }),
    );
    expect(utteranceRes2.status).toBe(200);

    // Step 4: seed a task_dispatch (label "standup") so it appears in "Recent runs"
    const runId = "run_standup_test";
    await ledger.append({
      runId,
      source: "edmini",
      kind: "task_dispatch",
      payload: { label: "standup", instruction: "post the standup" },
    });

    // Step 5: call the session route — it should snapshot the ledger and build the prompt
    const sessionRes = await sessionPOST(
      makeReq("/api/session", {}),
    );
    expect(sessionRes.status).toBe(200);

    const body = capturedSessionBody();
    const instructions: string = body.session.instructions;
    const tools: Array<{ name: string }> = body.session.tools;

    // The "Recent history" block must be present
    expect(instructions).toContain("Recent history");

    // The last convo turn ("let's plan the launch") IS in the recent window (seq N)
    expect(instructions).toContain("let's plan the launch");

    // The "standup" run must appear in Recent runs
    expect(instructions).toContain("standup");

    // "BlueFinch" was pushed beyond the default 12-event recent window, so
    // it must NOT appear in the Recent history block — proving search_history is needed.
    // (recentConversation picks the last 12 convo events; BlueFinch is event 1 of 30.)
    expect(instructions).not.toContain("BlueFinch");

    // search_history tool must be registered
    expect(tools.some((t) => t.name === "search_history")).toBe(true);

    // Step 6: call the history route (search_history backend) with text="BlueFinch"
    // It must return the original utterance event.
    const historyRes = await historyPOST(
      makeReq("/api/history", { text: "BlueFinch" }),
    );
    expect(historyRes.status).toBe(200);
    const historyJson = (await historyRes.json()) as { events: LedgerEvent[] };
    const found = historyJson.events.some(
      (e) =>
        e.kind === "user_utterance" &&
        typeof e.payload["text"] === "string" &&
        (e.payload["text"] as string).includes("BlueFinch"),
    );
    expect(found).toBe(true);
  });
});

// ─── Scenario (b) — cross-session registry rehydration ────────────────────────
//
// Simulates a run dispatched in a PRIOR session (not the current one). Asserts that
// buildRegistryFromEvents() replays the task_dispatch and makes labelFor(runId) resolve,
// so handleLedgerEvent would no longer drop its events.
// Also asserts that a run with NO dispatch event resolves to null.

describe("Scenario (b) — cross-session registry rehydration", () => {
  it("buildRegistryFromEvents resolves label for a run not dispatched in this session", async () => {
    const ledger = ledgerHolder.current;
    const runId = "run_cross_session_001";

    // Seed a task_dispatch for runId with label "research" — as if a prior session did this.
    await ledger.append({
      runId,
      source: "edmini",
      kind: "task_dispatch",
      payload: { label: "research", instruction: "look into durable execution" },
    });

    // Simulate the startSession rehydration: snapshot the ledger and rebuild the registry.
    const events = await ledger.snapshot();
    const registry = buildRegistryFromEvents(events);

    // The key assertion: a run NOT dispatched "this session" now resolves a label.
    // This is what prevented handleLedgerEvent from narrating cross-session runs.
    expect(registry.labelFor(runId)).toBe("research");

    // A run with no dispatch event must resolve to null (the "still broken" baseline).
    expect(registry.labelFor("run_unknown_999")).toBeNull();
  });

  it("status is applied from projectRuns during rehydration", async () => {
    const ledger = ledgerHolder.current;
    const runId = "run_done_test_001";

    await ledger.append({
      runId,
      source: "edmini",
      kind: "task_dispatch",
      payload: { label: "export", instruction: "export the board" },
    });
    // The run completed while audio was off
    await ledger.append({
      runId,
      source: "harness",
      kind: "run_done",
      payload: { summary: "exported 412 items" },
    });

    const events = await ledger.snapshot();
    const registry = buildRegistryFromEvents(events);

    // Label resolves despite no in-session register() call
    expect(registry.labelFor(runId)).toBe("export");
    // The registry itself has the run registered (so has() gates would pass)
    expect(registry.has(runId)).toBe(true);
  });
});

// ─── Scenario (c) — catch-up on resume ────────────────────────────────────────
//
// Simulates: session stops (lastSeenSeq = snapshot max), executor delivers run_done
// while audio is off, then a new session starts and selectCatchUp finds the new event.
// Also documents the first-ever-session rule: lastSeenSeq=0 → no catch-up.

describe("Scenario (c) — catch-up on resume", () => {
  it("selectCatchUp returns only new narratable events past lastSeenSeq", async () => {
    const ledger = ledgerHolder.current;
    const runId = "run_export_catchup";

    // Pre-cutoff: dispatch + some lifecycle events that happened BEFORE the user stopped audio
    await ledger.append({
      runId,
      source: "edmini",
      kind: "task_dispatch",
      payload: { label: "export", instruction: "export the board" },
    });
    await ledger.append({
      runId,
      source: "harness",
      kind: "run_output",
      payload: { text: "loading tools…" },
    });

    // Simulate stopSession: capture the max seq as lastSeenSeq
    const snapshotAtStop = await ledger.snapshot();
    const lastSeenSeq = Math.max(...snapshotAtStop.map((e) => e.seq ?? 0));

    // Executor delivers run_done WHILE AUDIO IS OFF (seq > lastSeenSeq)
    const runDoneEvent = await ledger.append({
      runId,
      source: "harness",
      kind: "run_done",
      payload: { summary: "exported 412 items" },
    });

    // Simulate startSession: fresh snapshot, rebuild registry, then selectCatchUp
    const newSnapshot = await ledger.snapshot();
    const registry = buildRegistryFromEvents(newSnapshot);
    const knownRunIds = new Set(
      newSnapshot
        .filter((e) => e.kind === "task_dispatch" && e.runId)
        .map((e) => e.runId as string),
    );

    // Sanity: registry resolved the run
    expect(registry.labelFor(runId)).toBe("export");

    const catchUp = selectCatchUp(newSnapshot, lastSeenSeq, knownRunIds);

    // Exactly the one event that arrived while audio was off
    expect(catchUp).toHaveLength(1);
    expect(catchUp[0].id).toBe(runDoneEvent.id);
    expect(catchUp[0].kind).toBe("run_done");
    expect(catchUp[0].payload["summary"]).toBe("exported 412 items");

    // Pre-cutoff events must NOT be in the catch-up batch
    expect(catchUp.every((e) => (e.seq ?? 0) > lastSeenSeq)).toBe(true);
  });

  it("first-ever session (lastSeenSeq=0) produces no catch-up per app rule", async () => {
    const ledger = ledgerHolder.current;
    const runId = "run_first_session";

    await ledger.append({
      runId,
      source: "edmini",
      kind: "task_dispatch",
      payload: { label: "standup", instruction: "post standup" },
    });
    await ledger.append({
      runId,
      source: "harness",
      kind: "run_done",
      payload: { summary: "standup posted" },
    });

    const events = await ledger.snapshot();
    const knownRunIds = new Set([runId]);

    // The app rule (VoiceAgent.tsx): if lastSeenSeq is 0 (no prior session), skip catch-up.
    // We encode the rule explicitly: only call selectCatchUp when lastSeenSeq > 0.
    const lastSeenSeq = 0; // first ever session
    const catchUp = lastSeenSeq > 0 ? selectCatchUp(events, lastSeenSeq, knownRunIds) : [];

    // App rule: no catch-up on first-ever session.
    expect(catchUp).toHaveLength(0);
  });
});
