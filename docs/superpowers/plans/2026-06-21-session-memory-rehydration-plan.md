# Session Memory — Rehydration, History & Catch-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a voice session memory: on session start, rehydrate the run registry and recent history from the append-only ledger, catch up on events missed while audio was off, and let Ed query older history with a tool.

**Architecture:** The ledger (Supabase `events`) is already the system of record; the client just never reads it back. We add (1) pure replay/selector helpers over the event stream, (2) an extended `snapshot` with query filters, (3) two new service-role API routes (`/api/history`, `/api/conversation/utterance`), (4) a dumb "Recent history" block + `search_history` tool in `/api/session`, and (5) client wiring in `VoiceAgent.tsx` to snapshot→rebuild registry→compute catch-up→dedup live events→log user utterances→record `prevRunId`. Memory is kept deliberately dumb (raw facts, no ranking) so the incoming graph memory replaces §3a wholesale without rework.

**Tech Stack:** TypeScript, Next.js App Router (route handlers, `runtime = "nodejs"`), `@supabase/supabase-js`, React + WebRTC (Realtime), Vitest (`pnpm test`), `tsx` for scripts.

**Spec:** `docs/superpowers/specs/2026-06-20-session-memory-rehydration-design.md` — read it before starting.

## Global Constraints

- **Opaque ids:** never parse `runId`/`threadId`; treat as opaque tokens (per `edmini-shd`).
- **Raw facts only:** record relationships (`prevRunId`) as scalar payload fields; NO management logic, NO head re-pointing, NO walk code, NO ranking/summarization. §3a is a disposable stopgap.
- **Fail open:** snapshot/rehydrate failures must NEVER block a session — log and degrade to today's empty-registry behavior (same fire-and-forget posture as `voice-output`).
- **Service-role on the server, anon on the client.** Client snapshot uses the anon key (Realtime already reads `events`); server writes/reads use `ledgerFromEnv({ serviceRole: true })`.
- **No `register` behaviour change** — collision-suffix rule stays exactly as in `src/lib/voice/run-registry.ts`.
- **Test command:** `pnpm test` (Vitest). Type/lint/build: `pnpm tsc --noEmit` (or `pnpm build`), `pnpm lint`.
- **`to`/addressivity is OUT OF SCOPE** — deferred to `edmini-qo3`. Reserve the param shape only; do not implement a `to` filter.
- Commit after each task. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/voice/run-registry.ts` | + pure `buildRegistryFromEvents(events)` | 1 |
| `src/lib/voice/__tests__/run-registry.test.ts` | rehydration tests | 1 |
| `src/lib/ledger.ts` | + `labelsByRun`, `recentConversation`, `selectCatchUp` pure selectors | 2 |
| `src/lib/__tests__/ledger.test.ts` | selector tests (add to existing file if present) | 2 |
| `src/lib/ledger-supabase.ts` | extend `snapshot` opts with `since/until/text/source/author/threadIds` | 3 |
| `src/app/api/conversation/utterance/route.ts` | NEW — service-role write of `user_utterance` | 4 |
| `src/app/api/conversation/utterance/__tests__/route.test.ts` | route test (mirror voice-output) | 4 |
| `src/app/api/history/route.ts` | NEW — backs `search_history`; validate params → filtered snapshot → raw events | 5 |
| `src/app/api/history/__tests__/route.test.ts` | filter behaviour tests | 5 |
| `src/app/api/session/route.ts` | inject `## Recent history`; register `search_history` tool | 6 |
| `src/app/api/session/__tests__/route.test.ts` | assert history block + tool present | 6 |
| `src/components/VoiceAgent.tsx` | rehydrate + catch-up + seq-dedup + lastSeenSeq | 7 |
| `src/components/VoiceAgent.tsx` | prevRunId + user-utterance log + search_history handler | 8 |

`src/app/api/bus/route.ts` already accepts and persists `prevRunId` — **no change needed** (verify only).

---

### Task 1: Pure registry rehydration (`buildRegistryFromEvents`)

**Files:**
- Modify: `src/lib/voice/run-registry.ts`
- Test: `src/lib/voice/__tests__/run-registry.test.ts`

**Interfaces:**
- Consumes: existing `createRunRegistry()`, `RunRegistry`, `RunStatus`; `LedgerEvent`, `projectRuns`, `RunState` from `../ledger` (note path: registry is in `src/lib/voice/`, ledger in `src/lib/`, so import `from "../ledger"`).
- Produces: `buildRegistryFromEvents(events: LedgerEvent[]): RunRegistry` — replays every `task_dispatch` event (in `seq` order) through the existing `register`, then applies status from `projectRuns`. Status mapping: `run_failed→"failed"`, `run_done→"done"`, `run_blocked→"blocked"`, else (`run_started|run_output|null`)→`"active"`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/voice/__tests__/run-registry.test.ts` (create if missing; if it exists, append these tests):

```typescript
import { describe, it, expect } from "vitest";
import { buildRegistryFromEvents } from "../run-registry";
import type { LedgerEvent } from "../../ledger";

const dispatch = (seq: number, runId: string, label: string | null): LedgerEvent => ({
  seq, runId, source: "edmini", kind: "task_dispatch", payload: { label },
});
const harness = (seq: number, runId: string, kind: string): LedgerEvent => ({
  seq, runId, source: "harness", kind, payload: {},
});

describe("buildRegistryFromEvents", () => {
  it("registers every dispatched run so labelFor is non-null (fixes b)", () => {
    const reg = buildRegistryFromEvents([dispatch(1, "run_a", "export")]);
    expect(reg.labelFor("run_a")).toBe("export");
    expect(reg.resolveLabel("export")).toBe("run_a");
  });

  it("replays in seq order and applies the existing collision-suffix rule", () => {
    const reg = buildRegistryFromEvents([
      dispatch(2, "run_b", "export"),
      dispatch(1, "run_a", "export"),
    ]);
    // seq 1 (run_a) registers "export"; seq 2 (run_b) collides → "export-2"
    expect(reg.labelFor("run_a")).toBe("export");
    expect(reg.labelFor("run_b")).toBe("export-2");
  });

  it("derives status from the latest run_* event via projectRuns", () => {
    const reg = buildRegistryFromEvents([
      dispatch(1, "run_a", "export"),
      harness(2, "run_a", "run_output"),
      harness(3, "run_a", "run_done"),
      dispatch(4, "run_b", "research"),
      harness(5, "run_b", "run_failed"),
      dispatch(6, "run_c", "blocked-one"),
      harness(7, "run_c", "run_blocked"),
    ]);
    expect(reg.statusFor?.("run_a") ?? statusViaSet(reg)).toBeDefined(); // see note
  });

  it("falls back to 'task' for a missing/empty label (register default)", () => {
    const reg = buildRegistryFromEvents([dispatch(1, "run_a", null)]);
    expect(reg.labelFor("run_a")).toBe("task");
  });

  it("ignores non-dispatch events for registration", () => {
    const reg = buildRegistryFromEvents([harness(1, "run_x", "run_output")]);
    expect(reg.labelFor("run_x")).toBeNull();
  });
});
```

> NOTE: `RunRegistry` exposes `setStatus` but no public status getter. To assert status without widening the public interface, the third test above is awkward. **Simplify it:** delete the `statusFor` line and instead assert behaviour indirectly — that the run is registered (`labelFor` non-null) for `run_a/b/c`. Status correctness is covered by `projectRuns`' own tests in `src/lib/__tests__/ledger.test.ts`. Keep the third test as:
> ```typescript
>   it("registers runs regardless of their terminal status", () => {
>     const reg = buildRegistryFromEvents([
>       dispatch(1, "run_a", "export"), harness(2, "run_a", "run_done"),
>       dispatch(3, "run_b", "research"), harness(4, "run_b", "run_failed"),
>     ]);
>     expect(reg.labelFor("run_a")).toBe("export");
>     expect(reg.labelFor("run_b")).toBe("research");
>   });
> ```
> Remove the `statusViaSet` helper reference. (Status IS applied by the impl below via `setStatus`; we just don't assert it through a getter.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/voice/__tests__/run-registry.test.ts`
Expected: FAIL — `buildRegistryFromEvents is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/voice/run-registry.ts` (and add the import at the top):

```typescript
import { projectRuns, type LedgerEvent } from "../ledger";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/voice/__tests__/run-registry.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/run-registry.ts src/lib/voice/__tests__/run-registry.test.ts
git commit -m "feat(iee): pure buildRegistryFromEvents for registry rehydration"
```

---

### Task 2: Pure ledger selectors (`labelsByRun`, `recentConversation`, `selectCatchUp`)

**Files:**
- Modify: `src/lib/ledger.ts`
- Test: `src/lib/__tests__/ledger.test.ts` (append; create if missing)

**Interfaces:**
- Produces:
  - `labelsByRun(events: LedgerEvent[]): Map<string, string>` — runId→label from `task_dispatch` payloads (last write wins by seq).
  - `recentConversation(events: LedgerEvent[], n: number): LedgerEvent[]` — the last `n` `user_utterance` + `voice_output` events by `seq`, oldest-first.
  - `selectCatchUp(events: LedgerEvent[], lastSeenSeq: number, knownRunIds: Set<string>): LedgerEvent[]` — narratable harness events (`run_done|run_blocked|run_failed|run_output`) with `seq > lastSeenSeq` whose `runId ∈ knownRunIds`, oldest-first.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/ledger.test.ts`:

```typescript
import { labelsByRun, recentConversation, selectCatchUp } from "../ledger";
import type { LedgerEvent } from "../ledger";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/__tests__/ledger.test.ts`
Expected: FAIL — selectors not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/ledger.ts`:

```typescript
const CONVERSATION_KINDS: ReadonlySet<string> = new Set(["user_utterance", "voice_output"]);
const CATCHUP_KINDS: ReadonlySet<string> = new Set(["run_done", "run_blocked", "run_failed", "run_output"]);

/** runId → label from task_dispatch payloads (last write wins by seq). Pure. */
export function labelsByRun(events: LedgerEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    if (e.kind !== "task_dispatch" || !e.runId) continue;
    if (typeof e.payload.label === "string" && e.payload.label) out.set(e.runId, e.payload.label);
  }
  return out;
}

/** The last n conversation events (user_utterance + voice_output) by seq, oldest-first. Pure. */
export function recentConversation(events: LedgerEvent[], n: number): LedgerEvent[] {
  const conv = events
    .filter((e) => CONVERSATION_KINDS.has(e.kind))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return n >= conv.length ? conv : conv.slice(conv.length - n);
}

/** Narratable harness events past lastSeenSeq for known runs, oldest-first (edmini-iee §2). Pure. */
export function selectCatchUp(
  events: LedgerEvent[],
  lastSeenSeq: number,
  knownRunIds: Set<string>,
): LedgerEvent[] {
  return events
    .filter(
      (e) =>
        (e.seq ?? 0) > lastSeenSeq &&
        CATCHUP_KINDS.has(e.kind) &&
        e.source === "harness" &&
        e.runId != null &&
        knownRunIds.has(e.runId),
    )
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/__tests__/ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ledger.ts src/lib/__tests__/ledger.test.ts
git commit -m "feat(iee): pure ledger selectors (labelsByRun, recentConversation, selectCatchUp)"
```

---

### Task 3: Extend the Supabase `snapshot` with query filters

**Files:**
- Modify: `src/lib/ledger-supabase.ts`

**Interfaces:**
- Produces: extended `snapshot` opts:
  ```typescript
  snapshot(opts?: {
    runId?: string; limit?: number;
    since?: string; until?: string;   // ISO timestamptz, filters on `ts`
    text?: string;                    // ILIKE over payload::text
    source?: LedgerSource;            // events.source (the coarse `from`)
    author?: string;                  // payload->>author (the coarse `from`)
    threadIds?: string[];             // events.thread_id IN (...) — channel filter resolves to these
  }): Promise<LedgerEvent[]>;
  ```
- Consumes: existing supabase query builder. Note `LedgerSource` must be imported (it's already exported from `./ledger`).

This file has no unit tests today (it needs a live DB); behaviour is verified through `/api/history` route tests in Task 5, which mock the ledger. So this task has no test step of its own — it ends when Task 5's tests pass. Keep the change minimal and obviously-correct.

- [ ] **Step 1: Implement the extended opts**

In `src/lib/ledger-supabase.ts`:
1. Add `type LedgerSource` to the existing import: `import { fromRow, toInsert, type LedgerEvent, type LedgerRow, type LedgerSource } from "./ledger";`
2. Update the `Ledger` interface `snapshot` signature to the opts above.
3. Replace the `snapshot` implementation body with:

```typescript
    async snapshot(opts = {}) {
      let query = client.from(TABLE).select("*").order("seq", { ascending: true });
      if (opts.runId) query = query.eq("run_id", opts.runId);
      if (opts.since) query = query.gte("ts", opts.since);
      if (opts.until) query = query.lte("ts", opts.until);
      if (opts.source) query = query.eq("source", opts.source);
      if (opts.author) query = query.eq("payload->>author", opts.author);
      if (opts.threadIds && opts.threadIds.length) query = query.in("thread_id", opts.threadIds);
      if (opts.text) query = query.ilike("payload", `%${opts.text}%`);
      if (opts.limit != null) query = query.limit(opts.limit);
      const { data, error } = await query;
      if (error) throw new Error(`ledger.snapshot failed: ${error.message}`);
      return (data as LedgerRow[]).map(fromRow);
    },
```

> NOTE on `text`: `payload` is `jsonb`; PostgREST `ilike` on a jsonb column may need a cast. If a live test shows `ilike("payload", ...)` errors, switch to `query.filter("payload::text", "ilike", `%${opts.text}%`)`. Leave a one-line comment to that effect. This is a degrade-gracefully filter; the route (Task 5) already catches errors.

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS (no type errors). Functional verification happens in Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ledger-supabase.ts
git commit -m "feat(iee): extend ledger snapshot with since/until/text/source/author/threadIds filters"
```

---

### Task 4: `/api/conversation/utterance` route (log User utterances)

**Files:**
- Create: `src/app/api/conversation/utterance/route.ts`
- Test: `src/app/api/conversation/utterance/__tests__/route.test.ts`

**Interfaces:**
- Produces: `POST` accepting `{ text: string; threadId?: string | null }` → appends `{ source: "user", kind: "user_utterance", payload: { text }, threadId }` via service-role ledger. Mirrors `src/app/api/voice-output/route.ts` exactly (same fail-open posture, same shape). Returns `{ ok: true }` or `{ error }`.

- [ ] **Step 1: Write the failing test**

Look at `src/app/api/voice-output/__tests__/route.test.ts` first and mirror its mocking style (it mocks `@/lib/ledger-supabase`). Create `src/app/api/conversation/utterance/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const append = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/lib/ledger-supabase", () => ({
  ledgerFromEnv: () => ({ append, snapshot: vi.fn(), subscribe: vi.fn() }),
}));

import { POST } from "../route";

const post = (body: unknown) =>
  POST(new Request("http://t/api/conversation/utterance", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));

describe("POST /api/conversation/utterance", () => {
  beforeEach(() => append.mockClear());

  it("appends a user_utterance event", async () => {
    const res = await post({ text: "do the export", threadId: "thr_1" });
    expect(res.status).toBe(200);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      source: "user", kind: "user_utterance", threadId: "thr_1",
      payload: { text: "do the export" },
    }));
  });

  it("400s on empty text and does not append", async () => {
    const res = await post({ text: "  " });
    expect(res.status).toBe(400);
    expect(append).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/conversation/utterance`
Expected: FAIL — module `../route` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/api/conversation/utterance/route.ts`:

```typescript
/**
 * User-utterance ledger tap (edmini-iee §4) — records the **User → edmini** boundary crossing.
 *
 * The ledger has Ed's side (voice_output) and run events but never the User's spoken turns (they live
 * only in /tmp topic state). Logging each finalized User transcript here completes the conversation
 * record (feeds the dumb "Recent history" block) and creates the message nodes the graph will use.
 * Service-role write, fire-and-forget from the client (mirrors /api/voice-output).
 *
 * POST body: { text: string, threadId?: string | null }
 */
import { ledgerFromEnv } from "@/lib/ledger-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: { text?: string; threadId?: string | null };
  try {
    body = (await request.json()) as { text?: string; threadId?: string | null };
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) return Response.json({ error: "text required" }, { status: 400 });

  try {
    const ledger = ledgerFromEnv({ serviceRole: true });
    await ledger.append({
      runId: null,
      threadId: body.threadId ?? null,
      source: "user",
      kind: "user_utterance",
      payload: { text },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/conversation/utterance`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/conversation/utterance/
git commit -m "feat(iee): /api/conversation/utterance logs User turns to the ledger"
```

---

### Task 5: `/api/history` route (backs `search_history`)

**Files:**
- Create: `src/app/api/history/route.ts`
- Test: `src/app/api/history/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `ledgerFromEnv({ serviceRole: true }).snapshot(opts)` (Task 3 opts); `threadStoreFromEnv` ONLY if implementing the `channel` filter (see note).
- Produces: `POST` accepting `{ limit?, runId?, apiIdentifier?, since?, until?, text?, source?, author?, channel? }` → validates/maps to snapshot opts → returns `{ events: LedgerEvent[] }`. Unknown/empty params degrade gracefully (ignored). Caps `limit` at 100 (default 30). On error returns `{ error }` 500 (Ed degrades).

> `channel` filter: resolve `channel` → `threadIds` by querying threads where `transport === channel || medium === channel`, then pass `threadIds` to snapshot. If the thread store doesn't expose a "list by transport/medium" method, IMPLEMENT THE REST WITHOUT `channel` for now and return events unfiltered by channel, logging a `// channel filter: pending thread-store query` comment. Do NOT block the route on it. (`to` is out of scope entirely.)

- [ ] **Step 1: Write the failing test**

Create `src/app/api/history/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const snapshot = vi.fn().mockResolvedValue([{ seq: 1, runId: "run_a", source: "user", kind: "user_utterance", payload: { text: "hi" } }]);
vi.mock("@/lib/ledger-supabase", () => ({
  ledgerFromEnv: () => ({ snapshot, append: vi.fn(), subscribe: vi.fn() }),
}));

import { POST } from "../route";

const post = (body: unknown) =>
  POST(new Request("http://t/api/history", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));

describe("POST /api/history", () => {
  beforeEach(() => snapshot.mockClear());

  it("maps params to snapshot opts and returns raw events", async () => {
    const res = await post({ runId: "run_a", text: "export", limit: 5 });
    const json = await res.json();
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ runId: "run_a", text: "export", limit: 5 }));
    expect(json.events).toHaveLength(1);
  });

  it("caps limit at 100 and defaults to 30", async () => {
    await post({ limit: 9999 });
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    await post({});
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ limit: 30 }));
  });

  it("ignores unsupported params (e.g. to) without error", async () => {
    const res = await post({ to: "someone", since: "2026-06-01T00:00:00Z" });
    expect(res.status).toBe(200);
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ since: "2026-06-01T00:00:00Z" }));
    expect(snapshot.mock.calls[0][0]).not.toHaveProperty("to");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/history`
Expected: FAIL — `../route` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/api/history/route.ts`:

```typescript
/**
 * History retrieval (edmini-iee §3b) — backs the `search_history` voice tool. A THIN parametric query
 * over the ledger: no ranking, no summarization. Its INTERFACE is durable into the graph era; only the
 * backend swaps (ledger snapshot → graph retrieval) behind this same route. `to`/addressivity is
 * deferred to edmini-qo3 (the param shape is reserved, not implemented).
 */
import { ledgerFromEnv } from "@/lib/ledger-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HistoryParams {
  limit?: number; runId?: string; apiIdentifier?: string;
  since?: string; until?: string; text?: string;
  source?: "user" | "edmini" | "harness"; author?: string; channel?: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: HistoryParams;
  try { body = (await request.json()) as HistoryParams; }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  const limit = Math.min(100, Math.max(1, typeof body.limit === "number" ? body.limit : 30));

  const opts: Record<string, unknown> = { limit };
  if (typeof body.runId === "string") opts.runId = body.runId;
  if (typeof body.since === "string") opts.since = body.since;
  if (typeof body.until === "string") opts.until = body.until;
  if (typeof body.text === "string" && body.text.trim()) opts.text = body.text.trim();
  if (body.source === "user" || body.source === "edmini" || body.source === "harness") opts.source = body.source;
  if (typeof body.author === "string") opts.author = body.author;
  // channel filter: pending thread-store query (resolve channel → threadIds). `to` is out of scope (qo3).

  try {
    const ledger = ledgerFromEnv({ serviceRole: true });
    const events = await ledger.snapshot(opts);
    return Response.json({ events });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/history`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/history/
git commit -m "feat(iee): /api/history route backs the search_history tool (thin ledger query)"
```

---

### Task 6: `/api/session` — Recent-history block + `search_history` tool

**Files:**
- Modify: `src/app/api/session/route.ts`
- Test: `src/app/api/session/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `ledgerFromEnv({ serviceRole: true }).snapshot({ limit })`, `recentConversation`, `labelsByRun`, `projectRuns` from `@/lib/ledger`.
- Produces: a `## Recent history` block appended to `instructions` (dumb recent-N dump: recent conversation lines + a flat list of recent runs with label+status); a new `search_history` tool object in the `tools` array.

The existing test (`src/app/api/session/__tests__/route.test.ts`) likely mocks OpenAI fetch + `getSystemPromptContext`. Read it and extend its mocks: add a `@/lib/ledger-supabase` mock returning a `snapshot` with a couple of events.

- [ ] **Step 1: Write the failing test**

Add to `src/app/api/session/__tests__/route.test.ts` (adapt the existing mock setup — ensure `ledgerFromEnv` is mocked so the route doesn't hit Supabase):

```typescript
// In the existing vi.mock block region, add:
vi.mock("@/lib/ledger-supabase", () => ({
  ledgerFromEnv: () => ({
    snapshot: vi.fn().mockResolvedValue([
      { seq: 1, runId: null, source: "user", kind: "user_utterance", payload: { text: "export the board" } },
      { seq: 2, runId: "run_a", source: "edmini", kind: "task_dispatch", payload: { label: "export" } },
      { seq: 3, runId: "run_a", source: "edmini", kind: "voice_output", payload: { text: "on it" } },
    ]),
    append: vi.fn(), subscribe: vi.fn(),
  }),
}));

it("injects a Recent history block and a search_history tool", async () => {
  // capture the body sent to OpenAI (the existing test already stubs global fetch — reuse that capture)
  const res = await POST(new Request("http://t/api/session", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  }));
  expect(res.status).toBe(200);
  const sent = JSON.parse((globalThis.fetch as any).mock.calls.at(-1)[1].body);
  expect(sent.session.instructions).toContain("Recent history");
  expect(sent.session.instructions).toContain("export the board");
  expect(sent.session.tools.some((t: any) => t.name === "search_history")).toBe(true);
});
```

> If the existing test stubs `fetch` differently, align with its pattern (it must already capture the OpenAI request body to assert tools today). Reuse that exact capture mechanism rather than the `.mock.calls.at(-1)` shown here.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/session`
Expected: FAIL — no "Recent history" / no `search_history` tool.

- [ ] **Step 3: Write minimal implementation**

In `src/app/api/session/route.ts`:
1. Add imports: `import { ledgerFromEnv } from "@/lib/ledger-supabase";` and `import { recentConversation, labelsByRun, projectRuns } from "@/lib/ledger";`
2. After `const topicContext = getSystemPromptContext();`, build the history block (fail-open):

```typescript
  let historyBlock = "";
  try {
    const events = await ledgerFromEnv({ serviceRole: true }).snapshot({ limit: 200 });
    const convo = recentConversation(events, 12)
      .map((e) => {
        const who = e.source === "user" ? "User" : "Ed";
        const text = typeof e.payload.text === "string" ? e.payload.text : "";
        return text ? `- ${who}: ${text}` : "";
      })
      .filter(Boolean);
    const labels = labelsByRun(events);
    const runs = projectRuns(events)
      .slice(-8)
      .map((r) => {
        const status =
          r.lastRunKind === "run_failed" ? "failed"
            : r.lastRunKind === "run_done" ? "done"
              : r.lastRunKind === "run_blocked" ? "blocked" : "active";
        return `- '${labels.get(r.runId) ?? r.runId}' — ${status}`;
      });
    if (convo.length || runs.length) {
      historyBlock = `\n\n## Recent history\n(From the ledger — your memory of recent turns and runs. Reference it; if the User points at something older, call search_history.)\n${
        convo.length ? `\nRecent conversation:\n${convo.join("\n")}` : ""
      }${runs.length ? `\n\nRecent runs:\n${runs.join("\n")}` : ""}`;
    }
  } catch { /* fail open — no history block */ }
```

3. Append `historyBlock` to the instructions template (e.g. change the template literal to end with `...infer which label the User means from context.")${historyBlock}` — simplest is to concatenate after the existing `const instructions = \`...\`;`: add a line `const instructionsWithHistory = instructions + historyBlock;` and pass `instructionsWithHistory` into the session body instead of `instructions`).
4. Add a `search_history` tool to the `tools` array (after `cancel_run`):

```typescript
    {
      type: "function",
      name: "search_history",
      description:
        "Search the conversation/run ledger for older context when the User refers to something not in your Recent history, or to follow a run's provenance. Returns raw events; read them and answer faithfully. Each result may carry prevRunId — re-call with that runId to walk a run's lineage one hop at a time.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Free-text to match in event payloads." },
          runId: { type: "string", description: "Restrict to one run (opaque id from a prior result)." },
          since: { type: "string", description: "ISO timestamp lower bound." },
          until: { type: "string", description: "ISO timestamp upper bound." },
          source: { type: "string", enum: ["user", "edmini", "harness"], description: "Who emitted the event." },
          limit: { type: "number", description: "Max events to return (default 30, max 100)." },
        },
      },
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/session`
Expected: PASS. Also run the full route suite to confirm no regression: `pnpm test src/app/api`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/session/route.ts src/app/api/session/__tests__/route.test.ts
git commit -m "feat(iee): inject dumb Recent history block + search_history tool into /api/session"
```

---

### Task 7: Client — registry rehydration, catch-up, seq-dedup, lastSeenSeq

**Files:**
- Modify: `src/components/VoiceAgent.tsx`

**Interfaces:**
- Consumes: `buildRegistryFromEvents` (Task 1), `selectCatchUp` (Task 2) from their modules; `ledgerFromEnv().snapshot()` (anon) (Task 3).
- Produces: on `startSession`, the registry is rebuilt from a ledger snapshot before subscribing; `lastProcessedSeqRef` is seeded; a "while you were away" catch-up batch is spoken once the channel opens; `handleLedgerEvent` dedups by seq; `lastSeenSeq` persists to `localStorage` across sessions.

No unit test (React/WebRTC component, no harness). Verify via `pnpm tsc --noEmit`, `pnpm build`, `pnpm lint`, and the spec's live checks (b)/(c). The decision logic it relies on (`buildRegistryFromEvents`, `selectCatchUp`) is already unit-tested in Tasks 1–2.

- [ ] **Step 1: Add refs + a localStorage key**

Near the other refs (around line 200), add:
```typescript
  const lastProcessedSeqRef = useRef<number>(0);
```
Near `GRADING_KEY` (top-of-file constants), add:
```typescript
const LAST_SEEN_SEQ_KEY = "edmini.lastSeenSeq";
```

- [ ] **Step 2: Import the helpers**

Update imports:
```typescript
import { createRunRegistry, buildRegistryFromEvents, type RunRegistry } from "@/lib/voice/run-registry";
import { selectCatchUp } from "@/lib/ledger";
```

- [ ] **Step 3: Rehydrate + compute catch-up in `startSession` (before subscribe, ~line 805)**

Replace the subscribe block (the `try { ledgerChannelRef.current = ledgerFromEnv().subscribe(handleLedgerEvent); } catch {...}`) with a rehydrate-then-subscribe sequence. Insert BEFORE it:

```typescript
      // Rehydrate the registry + compute catch-up from a ledger snapshot (edmini-iee §1/§2). Fail open.
      let catchUpBatch: NarrationBatch = [];
      try {
        const ledger = ledgerFromEnv();
        const snap = await ledger.snapshot();
        const rebuilt = buildRegistryFromEvents(snap);
        runRegistryRef.current = rebuilt;
        const maxSeq = snap.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
        const lastSeen = Number(localStorage.getItem(LAST_SEEN_SEQ_KEY) ?? "0");
        lastProcessedSeqRef.current = maxSeq;
        if (lastSeen > 0) {
          const known = new Set(snap.filter((e) => e.kind === "task_dispatch" && e.runId).map((e) => e.runId as string));
          catchUpBatch = selectCatchUp(snap, lastSeen, known).map((e) => ({
            priority: 1, kind: e.kind,
            label: rebuilt.labelFor(e.runId as string) ?? undefined,
            text: NARRATE[e.kind]?.render(e.payload) ?? e.kind,
          }));
        }
      } catch (err) {
        pushEvent({ kind: "error", label: "Rehydrate failed (starting fresh)", detail: err instanceof Error ? err.message : String(err) });
      }
```

> `NarrationBatch`/`NarrationItem` shape: check the import from the narration-queue module and match its item fields (`priority`, `kind`, `text`, `label?`). Adjust the mapped object to the real type.

- [ ] **Step 4: Speak the catch-up batch when the data channel opens**

The component has no `dc.onopen` today. Add one right after `dc.onmessage = handleDataChannelMessage;` (~line 802):

```typescript
      dc.onopen = () => {
        if (catchUpBatch.length) {
          edInitiatedPendingRef.current = true;
          const lines = catchUpBatch.map((i) => (i.label ? `Run '${i.label}' ${i.text}` : i.text)).join(". ");
          fireResponse(() =>
            dcRef.current?.send(JSON.stringify({
              type: "conversation.item.create",
              item: { type: "message", role: "user", content: [{ type: "input_text",
                text: `(While you were away, these updates arrived — relay them to the User briefly as a catch-up, in your own words; name each task; relay ONLY what they say, do not claim completion unless tagged finished.) ${lines}` }] },
            })),
          );
        }
      };
```

- [ ] **Step 5: Seq-dedup + advance lastSeen in `handleLedgerEvent`**

At the top of `handleLedgerEvent` (line 305), after the `source/runId` guard, add the dedup; and advance the ref at the end:
```typescript
      if ((event.seq ?? 0) <= lastProcessedSeqRef.current) return; // snapshot↔subscribe idempotency
      lastProcessedSeqRef.current = Math.max(lastProcessedSeqRef.current, event.seq ?? 0);
```
> Place the advance BEFORE the `if (!label) return` early-out so a deduped-but-unlabeled event still advances the cursor. Put the dedup check first, then the advance, then the existing `labelFor`/spec logic. Add `lastProcessedSeqRef` is not a dep (it's a ref) — `useCallback` deps unchanged.

- [ ] **Step 6: Persist lastSeenSeq on `stopSession`**

In `stopSession` (~line 855), before resetting the registry, persist the cursor:
```typescript
    try { localStorage.setItem(LAST_SEEN_SEQ_KEY, String(lastProcessedSeqRef.current)); } catch { /* ignore */ }
    lastProcessedSeqRef.current = 0;
```

- [ ] **Step 7: Verify type/build/lint**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm build`
Expected: all PASS. Fix any type mismatches (esp. the `NarrationBatch` item shape and `ledgerFromEnv().snapshot()` opts).

- [ ] **Step 8: Commit**

```bash
git add src/components/VoiceAgent.tsx
git commit -m "feat(iee): rehydrate registry + catch-up on resume + seq-dedup + lastSeenSeq (fixes b,c)"
```

---

### Task 8: Client — `prevRunId` recording, User-utterance logging, `search_history` handling

**Files:**
- Modify: `src/components/VoiceAgent.tsx`

**Interfaces:**
- Consumes: `registry.resolveLabel`; the `voiceThreadIdRef`; `/api/bus`, `/api/conversation/utterance`, `/api/history`; `sendToolResult` (Task in-file).
- Produces: dispatch records `prevRunId`; each finalized User transcript is logged; `search_history` tool calls are handled.

- [ ] **Step 1: Record `prevRunId` on `delegate_task` dispatch**

In `dispatchToolCall`, `delegate_task` branch (~line 361), compute `prevRunId` from the label BEFORE registering this run, and include it in the bus body:
```typescript
          const prevRunId = registry.resolveLabel(requestedLabel); // raw provenance fact (null if first use)
          const { ok, data } = await callBus({
            action: "dispatch",
            instruction,
            label: requestedLabel,
            prevRunId,
          });
```
(The bus route already writes `prevRunId` into the `task_dispatch` payload — verified, no server change.)

- [ ] **Step 2: Add a `logUserUtterance` helper**

Near `logVoiceOutput` (~line 512), add:
```typescript
  // Log a finalized User turn (User → edmini crossing) to the ledger (edmini-iee §4). Fire-and-forget.
  const logUserUtterance = useCallback((text: string) => {
    if (!text.trim()) return;
    void fetch("/api/conversation/utterance", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, threadId: voiceThreadIdRef.current }),
    }).catch(() => {});
  }, []);
```
Add `logUserUtterance` to `handleDataChannelMessage`'s `useCallback` dependency array.

- [ ] **Step 3: Call it where the User transcript finalizes**

In the `conversation.item.input_audio_transcription.completed` handler (~line 708), in the NON-suppressed branch where `transcript?.trim()` is truthy, add `logUserUtterance(text);` right after `const text = transcript.trim();` (do NOT log in the suppressed branch — suppressed turns go to `/api/heard` only).

- [ ] **Step 4: Handle the `search_history` tool call**

In `dispatchToolCall`, add a branch before the unknown-tool fallthrough:
```typescript
        if (name === "search_history") {
          pushEvent({ kind: "info", label: "Tool call: search_history", detail: JSON.stringify(args).slice(0, 120) });
          const res = await fetch("/api/history", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args),
          });
          const data = (res.ok ? await res.json() : { error: await res.text() }) as Record<string, unknown>;
          sendToolResult(callId, JSON.stringify(data));
          return;
        }
```

- [ ] **Step 5: Verify type/build/lint**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 6: Run the full test suite**

Run: `pnpm test`
Expected: all green (Tasks 1–6 unit tests + existing suite).

- [ ] **Step 7: Commit**

```bash
git add src/components/VoiceAgent.tsx
git commit -m "feat(iee): record prevRunId, log User utterances, handle search_history tool"
```

---

## Final verification (after all tasks)

- [ ] `pnpm test` — all green.
- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm build` — clean.
- [ ] **Live (b):** dispatch a run, reload the page, let the executor reply → it narrates (not dropped).
- [ ] **Live (c):** dispatch, stop audio, let the executor finish, resume → Ed says "while you were away…".
- [ ] **Live (a):** after reload ask "what were we doing" → Ed recalls from Recent history; ask about something older → Ed calls `search_history` and recalls it.
- [ ] Update `docs/SESSION_SUMMARIES.md` and the journal; `bd close edmini-iee --reason "..."` + `bd label add edmini-iee needs-verification`.

## Out of scope (do not build)

- Relationship management, multi-hop lineage walking, `trace_run` — the graph owns these.
- Retrieval ranking/summarization — §3a is a dumb stopgap.
- `to`/addressivity capture → `edmini-qo3`.
- `projectGraph`, typed/multi-parent edges, topic clustering.
