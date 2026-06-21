# Channel-Agnostic Identity & Thread Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Discord-snowflake-as-`runId` with our own minted opaque ids, model the conversation **thread** as a first-class medium-aware entity, and rename the mislabeled `Thread`→`Topic` — so the ledger is channel-agnostic and ready for the future graph.

**Architecture:** Identity = minted prefixed ids (`run_<uuid>`, `thr_<uuid>`); the transport-native id is retained under a uniform `api_identifier`. A new `threads` table is the indexed, bidirectional `id↔api_identifier` map; `events` gains `thread_id`. Runs stay event-sourced (`projectRuns`). The transport interface speaks `api_identifier`; `/api/bus` owns identity; the worker resolves `api_identifier → {threadId, runId}` on inbound.

**Tech Stack:** TypeScript, Next.js 15 (App Router), Supabase (Postgres + Realtime), discord.js (worker), vitest, pnpm.

**Spec:** [docs/superpowers/specs/2026-06-20-channel-agnostic-identity-design.md](2026-06-20-channel-agnostic-identity-design.md) · **Bead:** `edmini-shd`

---

## Conventions for the executor

- Test runner: **vitest**. Run all: `pnpm test`. Run one file: `pnpm test src/lib/__tests__/ids.test.ts`.
- Typecheck: `pnpm exec tsc --noEmit`. Lint: `pnpm lint`. Build: `pnpm build`.
- SQL columns are **snake_case** (`api_identifier`, `thread_id`, `run_id`); TS/JSON payload keys are **camelCase** (`apiIdentifier`, `threadId`). They denote the same field (see spec "Casing convention").
- Commit after every task. Use a worktree for this work (large, multi-file): see `superpowers:using-git-worktrees`.
- **Migrations are applied manually** against Supabase (`psql "$SUPABASE_URL"` or the Supabase SQL editor) — there is no automated migration runner in this repo. Each migration task's "verify" step is the SQL to run + the expected catalog check.

## File structure

**Create:**
- `infra/supabase/migrations/0002_threads_identity.sql` — `threads` table + indexes; `events.thread_id` column.
- `src/lib/ids.ts` — pure id minting (`mintRunId`, `mintThreadId`).
- `src/lib/threads.ts` — `ThreadRecord` type + pure helpers; thin Supabase binding (`createThreadStore`, `threadStoreFromEnv`).
- `src/app/api/threads/route.ts` — service-role create-thread endpoint (used by the voice client to record its `voice` thread).
- `tests`: `src/lib/__tests__/ids.test.ts`, `src/lib/__tests__/threads.test.ts`.

**Rename (Group 1):**
- `src/lib/thread-manager.ts` → `src/lib/topic-manager.ts` (`Thread`→`Topic`).
- `src/lib/classify-thread.ts` → `src/lib/classify-topic.ts`.
- `src/app/api/threads/{route,[id]/route,[id]/message/route,classify/route}.ts` → `src/app/api/topics/...`.

**Modify:**
- `src/lib/ledger.ts` — `LedgerEvent.threadId`, `LedgerRow.thread_id`, `fromRow`/`toInsert`.
- `src/lib/bus/transport.ts` — `DispatchResult` → `{ apiIdentifier, messageApiId }`; `answer/cancel(apiIdentifier, …)`.
- `src/lib/bus/discord-transport.ts` — return `apiIdentifier`; rename params.
- `src/app/api/bus/route.ts` — mint ids, write `threads` row, resolve for answer/cancel.
- `worker/index.ts` — resolve `api_identifier → {threadId, runId}`; write `thread_id` + message `apiIdentifier`.
- `src/components/VoiceAgent.tsx` — record the `voice` thread; topic-rename touch-ups.

## Sequencing note (deviates from spec phase order — rename first)

The spec lists the topic rename as phase 4. We do it **first** (Group 1) because it frees the `/api/threads/*` route namespace and the word "thread" for the real thread entity, so later groups can add `/api/threads` cleanly. Groups 2–6 are the identity/thread core in spec order.

---

## Group 1 — Topic rename (mechanical, independent)

Pure rename: the existing `Thread` (name/status/category/summary) is really a topic. No behaviour change.

### Task 1: Rename the thread-manager module and type → topic

**Files:**
- Rename: `src/lib/thread-manager.ts` → `src/lib/topic-manager.ts`
- Rename: `src/lib/classify-thread.ts` → `src/lib/classify-topic.ts`
- Modify: every importer (found via grep)

- [ ] **Step 1: Move the files (preserve history)**

```bash
git mv src/lib/thread-manager.ts src/lib/topic-manager.ts
git mv src/lib/classify-thread.ts src/lib/classify-topic.ts
```

- [ ] **Step 2: Rename the type and exported symbols inside `topic-manager.ts`**

Apply these exact renames in `src/lib/topic-manager.ts` (identifiers only — keep `getSystemPromptContext` name unchanged since callers depend on it):
- `interface Thread` → `interface Topic`; `ThreadStatus` → `TopicStatus`; `ThreadMessage` → `TopicMessage`.
- `THREADS_FILE = "/tmp/ed-threads.json"` → `TOPICS_FILE = "/tmp/ed-topics.json"`.
- `SEED_THREADS` → `SEED_TOPICS`; `threads`/`thread` locals → `topics`/`topic`.
- Functions: `getThreads`→`getTopics`, `getThread`→`getTopic`, `createThread`→`createTopic`, `updateThread`→`updateTopic`, `addMessage` (keep), `resetThreads`→`resetTopics`. `getSystemPromptContext` keeps its name and behaviour.

- [ ] **Step 3: Find every importer**

Run: `grep -rn "thread-manager\|classify-thread\|getThreads\|getThread\b\|createThread\|updateThread\|resetThreads\|ThreadStatus\|ThreadMessage\|\bThread\b" src --include="*.ts" --include="*.tsx"`
Expected: hits in `src/app/api/threads/*`, `src/components/VoiceAgent.tsx`, `src/lib/classify-topic.ts`, tests. Update each import path + symbol to the new names.

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no missing-symbol errors).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(shd): rename Thread→Topic (thread-manager→topic-manager) [edmini-shd]"
```

### Task 2: Rename the API routes `/api/threads/*` → `/api/topics/*`

**Files:**
- Rename: `src/app/api/threads/` → `src/app/api/topics/` (directory)
- Modify: `src/components/VoiceAgent.tsx` (`postTurnToThread` + fetch URLs), any other callers

- [ ] **Step 1: Move the route directory**

```bash
git mv src/app/api/threads src/app/api/topics
```

- [ ] **Step 2: Update route internals**

In the moved files, rename internal helpers referencing "thread" topic-store calls to the Task-1 symbols (`getTopic`, `createTopic`, etc.). The route response key `threadId` from `classify/route.ts` becomes `topicId`.

- [ ] **Step 3: Update the client caller**

In `src/components/VoiceAgent.tsx`: rename `postTurnToThread` → `postTurnToTopic`; change fetch URLs `"/api/threads/classify"` → `"/api/topics/classify"` and `` `/api/threads/${threadId}/message` `` → `` `/api/topics/${topicId}/message` ``; rename the destructured `{ threadId }` → `{ topicId }` and the `if (threadId === "general")` guard accordingly.

- [ ] **Step 4: Grep for stragglers**

Run: `grep -rn "/api/threads" src --include="*.ts" --include="*.tsx"`
Expected: no results.

- [ ] **Step 5: Typecheck + test + commit**

```bash
pnpm exec tsc --noEmit && pnpm test
git add -A && git commit -m "refactor(shd): rename /api/threads → /api/topics; postTurnToTopic [edmini-shd]"
```

---

## Group 2 — Migration, ids, ledger field, threads lib

### Task 3: Migration 0002 — `threads` table + `events.thread_id`

**Files:**
- Create: `infra/supabase/migrations/0002_threads_identity.sql`

- [ ] **Step 1: Write the migration**

```sql
-- edmini shd — channel-agnostic identity & the thread model.
-- Identity = minted run_<uuid>/thr_<uuid> (opaque). The transport-native handle is kept as
-- api_identifier. threads is the first-class, bidirectional id<->api_identifier map.

-- ── threads: conversation loci (voice | written) ────────────────────────────
create table if not exists public.threads (
  id             text        primary key,                 -- thr_<uuid> (minted by us)
  medium         text        not null check (medium in ('voice','written')),
  transport      text        not null,                    -- 'discord' | 'openai-realtime' | ...
  api_identifier text        not null,                    -- transport-native handle (thread id / session id)
  run_id         text,                                    -- denormalized for the 1:1 executor case (null for voice)
  topic_id       text,                                    -- link to a topic (deferred; nullable)
  created_at     timestamptz not null default now()
);

-- inbound resolution: api_identifier -> thread (worker hot path)
create unique index if not exists threads_transport_apiid_idx
  on public.threads (transport, api_identifier);
-- outbound resolution: run_id -> thread (answer/cancel)
create index if not exists threads_run_id_idx on public.threads (run_id);

-- ── events gain thread_id (the conversation locus) ──────────────────────────
alter table public.events add column if not exists thread_id text;
create index if not exists events_thread_idx on public.events (thread_id);
```

- [ ] **Step 2: (Prototype) wipe existing data first**

This is a prototype — wipe the ledger so there are no pre-shd snowflake runs to reconcile (makes the
legacy fallback dead code in practice, kept only as cheap robustness):
```sql
truncate table public.events;          -- append-only trigger blocks DELETE, not TRUNCATE
drop table if exists public.threads;   -- recreated cleanly by the migration below
```

- [ ] **Step 3: Apply + verify**

Run against Supabase (SQL editor or `psql "$SUPABASE_URL" -f infra/supabase/migrations/0002_threads_identity.sql`).
Verify:
```sql
select column_name from information_schema.columns where table_name='threads' order by 1;
-- expect: api_identifier, created_at, id, medium, run_id, topic_id, transport
select column_name from information_schema.columns where table_name='events' and column_name='thread_id';
-- expect: thread_id
```

- [ ] **Step 4: Commit**

```bash
git add infra/supabase/migrations/0002_threads_identity.sql
git commit -m "feat(shd): migration — threads table + events.thread_id [edmini-shd]"
```

### Task 4: `src/lib/ids.ts` — minted prefixed ids

**Files:**
- Create: `src/lib/ids.ts`
- Test: `src/lib/__tests__/ids.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mintRunId, mintThreadId, RUN_PREFIX, THREAD_PREFIX } from "../ids";

describe("ids", () => {
  it("mints prefixed, unique run ids", () => {
    const a = mintRunId(), b = mintRunId();
    expect(a.startsWith(RUN_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(RUN_PREFIX.length + 30); // prefix + uuid
  });
  it("mints prefixed, unique thread ids", () => {
    const a = mintThreadId();
    expect(a.startsWith(THREAD_PREFIX)).toBe(true);
    expect(mintThreadId()).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `pnpm test src/lib/__tests__/ids.test.ts`
Expected: FAIL ("Cannot find module '../ids'").

- [ ] **Step 3: Implement**

```ts
/**
 * Minted, opaque, prefixed identities we own (edmini-shd). Prefixes make ids self-describing in
 * logs and the ledger. Channel-agnostic: a runId/threadId never encodes a transport.
 */
export const RUN_PREFIX = "run_";
export const THREAD_PREFIX = "thr_";

function uuid(): string {
  return crypto.randomUUID();
}

export function mintRunId(): string {
  return `${RUN_PREFIX}${uuid()}`;
}

export function mintThreadId(): string {
  return `${THREAD_PREFIX}${uuid()}`;
}
```

- [ ] **Step 4: Run → pass**

Run: `pnpm test src/lib/__tests__/ids.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ids.ts src/lib/__tests__/ids.test.ts
git commit -m "feat(shd): minted prefixed ids (run_/thr_) [edmini-shd]"
```

### Task 5: `LedgerEvent.threadId` — carry the conversation locus

**Files:**
- Modify: `src/lib/ledger.ts` (`LedgerEvent`, `LedgerRow`, `fromRow`, `toInsert`)
- Test: `src/lib/__tests__/ledger.test.ts` (add cases)

- [ ] **Step 1: Add the failing test**

Append to `src/lib/__tests__/ledger.test.ts`:
```ts
import { fromRow, toInsert } from "../ledger";

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
```

- [ ] **Step 2: Run → fail**

Run: `pnpm test src/lib/__tests__/ledger.test.ts`
Expected: FAIL (type error / `threadId` undefined).

- [ ] **Step 3: Implement** — edit `src/lib/ledger.ts`:

In `LedgerEvent` add `threadId?: string | null;` (after `runId`). In `LedgerRow` add `thread_id: string | null;` (after `run_id`). Update:
```ts
export function fromRow(r: LedgerRow): LedgerEvent {
  return {
    id: r.id, seq: r.seq, ts: r.ts,
    runId: r.run_id,
    threadId: r.thread_id ?? null,
    source: r.source, kind: r.kind,
    payload: r.payload ?? {},
  };
}

export function toInsert(e: LedgerEvent): Pick<LedgerRow, "run_id" | "thread_id" | "source" | "kind" | "payload"> {
  return { run_id: e.runId, thread_id: e.threadId ?? null, source: e.source, kind: e.kind, payload: e.payload ?? {} };
}
```

- [ ] **Step 4: Run → pass**

Run: `pnpm test src/lib/__tests__/ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ledger.ts src/lib/__tests__/ledger.test.ts
git commit -m "feat(shd): LedgerEvent.threadId (thread_id mapping) [edmini-shd]"
```

### Task 6: `src/lib/threads.ts` — type, pure legacy fallback, Supabase binding

**Files:**
- Create: `src/lib/threads.ts`
- Test: `src/lib/__tests__/threads.test.ts`

- [ ] **Step 1: Write the failing test (pure parts)**

```ts
import { describe, it, expect } from "vitest";
import { legacyThreadFor, type ThreadRecord } from "../threads";

describe("threads pure helpers", () => {
  it("legacy fallback: an unmapped api_identifier resolves to itself as run_id", () => {
    // Pre-shd runs have no threads row: api_identifier == run_id (the Discord snowflake).
    const t: ThreadRecord = legacyThreadFor("discord", "123456789");
    expect(t.runId).toBe("123456789");
    expect(t.apiIdentifier).toBe("123456789");
    expect(t.id).toBe("123456789"); // legacy: thread id == the snowflake
    expect(t.medium).toBe("written");
    expect(t.transport).toBe("discord");
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `pnpm test src/lib/__tests__/threads.test.ts`
Expected: FAIL ("Cannot find module '../threads'").

- [ ] **Step 3: Implement**

```ts
/**
 * Threads (edmini-shd) — the conversation locus (voice | written) and the first-class, bidirectional
 * map between our minted ids and a transport-native handle (api_identifier). Pure type + helpers here;
 * the thin Supabase binding mirrors ledger-supabase.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ThreadMedium = "voice" | "written";

export interface ThreadRecord {
  id: string;                 // thr_<uuid> (or, for legacy, the snowflake itself)
  medium: ThreadMedium;
  transport: string;          // 'discord' | 'openai-realtime' | ...
  apiIdentifier: string;      // transport-native handle
  runId: string | null;       // denormalized for the 1:1 executor case (null for voice)
  topicId: string | null;
  createdAt?: string;
}

interface ThreadRow {
  id: string;
  medium: ThreadMedium;
  transport: string;
  api_identifier: string;
  run_id: string | null;
  topic_id: string | null;
  created_at?: string;
}

function fromRow(r: ThreadRow): ThreadRecord {
  return {
    id: r.id, medium: r.medium, transport: r.transport,
    apiIdentifier: r.api_identifier, runId: r.run_id, topicId: r.topic_id, createdAt: r.created_at,
  };
}

/**
 * Back-compat (no migration): a pre-shd run has no threads row, so its Discord snowflake IS the id and
 * the api_identifier. Resolvers fall back to this so old runs still answer/cancel/deep-link.
 */
export function legacyThreadFor(transport: string, apiIdentifier: string): ThreadRecord {
  return { id: apiIdentifier, medium: "written", transport, apiIdentifier, runId: apiIdentifier, topicId: null };
}

export interface ThreadStore {
  insert(t: Omit<ThreadRecord, "createdAt">): Promise<ThreadRecord>;
  byApiIdentifier(transport: string, apiIdentifier: string): Promise<ThreadRecord | null>;
  byRunId(runId: string): Promise<ThreadRecord | null>;
}

const TABLE = "threads";

export function createThreadStore(client: SupabaseClient): ThreadStore {
  return {
    async insert(t) {
      const row = {
        id: t.id, medium: t.medium, transport: t.transport,
        api_identifier: t.apiIdentifier, run_id: t.runId, topic_id: t.topicId,
      };
      const { data, error } = await client.from(TABLE).insert(row).select().single();
      if (error) throw new Error(`threads.insert failed: ${error.message}`);
      return fromRow(data as ThreadRow);
    },
    async byApiIdentifier(transport, apiIdentifier) {
      const { data, error } = await client.from(TABLE).select("*")
        .eq("transport", transport).eq("api_identifier", apiIdentifier).maybeSingle();
      if (error) throw new Error(`threads.byApiIdentifier failed: ${error.message}`);
      return data ? fromRow(data as ThreadRow) : null;
    },
    async byRunId(runId) {
      const { data, error } = await client.from(TABLE).select("*").eq("run_id", runId).maybeSingle();
      if (error) throw new Error(`threads.byRunId failed: ${error.message}`);
      return data ? fromRow(data as ThreadRow) : null;
    },
  };
}

export function threadStoreFromEnv(opts: { serviceRole?: boolean } = {}): ThreadStore {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = opts.serviceRole
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("SUPABASE_URL is required");
  if (!key) throw new Error(`Supabase ${opts.serviceRole ? "service-role" : "anon"} key is required`);
  return createThreadStore(createClient(url, key, { auth: { persistSession: false } }));
}
```

- [ ] **Step 4: Run → pass**

Run: `pnpm test src/lib/__tests__/threads.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/threads.ts src/lib/__tests__/threads.test.ts
git commit -m "feat(shd): threads lib — type, legacy fallback, Supabase binding [edmini-shd]"
```

---

## Group 3 — Transport interface + bus route

### Task 7: Transport interface speaks `api_identifier`

**Files:**
- Modify: `src/lib/bus/transport.ts`, `src/lib/bus/discord-transport.ts`
- Test: `src/lib/bus/__tests__/discord-transport.test.ts` (update expectations)

- [ ] **Step 1: Update the interface** in `src/lib/bus/transport.ts`:

```ts
export interface DispatchResult {
  /** Transport-native handle for the created thread (e.g. the Discord thread id). NOT our runId. */
  apiIdentifier: string;
  /** Transport-native id of the dispatch message itself (for deep-linking). */
  messageApiId: string;
}

export interface BusTransport {
  /** Create a thread for a task; returns the transport handle. (outbound: task_dispatch) */
  dispatch(instruction: string): Promise<DispatchResult>;
  /** Reply to a blocked run's question, by the thread's transport handle. (outbound: answer) */
  answer(apiIdentifier: string, text: string): Promise<void>;
  /** Ask the harness to stop; by the thread's transport handle. (outbound: cancel) */
  cancel(apiIdentifier: string, reason?: string): Promise<void>;
}
```

- [ ] **Step 2: Update `discord-transport.ts`**

Rename the returned fields and params:
```ts
async dispatch(instruction): Promise<DispatchResult> {
  const name = (instruction.replace(/\s+/g, " ").trim().slice(0, 90)) || "edmini task";
  const thread = await req<{ id: string }>(`/channels/${cfg.channelId}/threads`, {
    name, type: PUBLIC_THREAD, auto_archive_duration: AUTO_ARCHIVE_MIN,
  });
  const msg = await postMessage(thread.id, renderOutbound("task_dispatch", { instruction }));
  return { apiIdentifier: thread.id, messageApiId: msg.id };
},
async answer(apiIdentifier, text): Promise<void> {
  await postMessage(apiIdentifier, renderOutbound("answer", { text }));
},
async cancel(apiIdentifier, reason): Promise<void> {
  await postMessage(apiIdentifier, renderOutbound("cancel", { reason }));
},
```

- [ ] **Step 3: Update the transport test**

In `src/lib/bus/__tests__/discord-transport.test.ts`, change assertions reading `result.runId`/`result.messageId` to `result.apiIdentifier`/`result.messageApiId`; `answer`/`cancel` arg names are positional so calls are unchanged.

- [ ] **Step 4: Run → pass**

Run: `pnpm test src/lib/bus/__tests__/discord-transport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bus/transport.ts src/lib/bus/discord-transport.ts src/lib/bus/__tests__/discord-transport.test.ts
git commit -m "feat(shd): transport interface speaks api_identifier [edmini-shd]"
```

### Task 8: `/api/bus` mints ids, writes the `threads` row, resolves answer/cancel

**Files:**
- Modify: `src/app/api/bus/route.ts`
- Test: `src/app/api/bus/__tests__/route.test.ts` (update/extend)

- [ ] **Step 1: Rewrite the handler body** in `src/app/api/bus/route.ts`:

```ts
import { discordTransportFromEnv } from "@/lib/bus/discord-transport";
import { ledgerFromEnv } from "@/lib/ledger-supabase";
import { threadStoreFromEnv } from "@/lib/threads";
import { mintRunId, mintThreadId } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BusRequest =
  | { action: "dispatch"; instruction: string; label?: string; prevRunId?: string | null }
  | { action: "answer"; runId: string; text: string }
  | { action: "cancel"; runId: string; reason?: string };

const TRANSPORT = "discord";

export async function POST(request: Request): Promise<Response> {
  let body: BusRequest;
  try { body = (await request.json()) as BusRequest; }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  const transport = discordTransportFromEnv();
  const ledger = ledgerFromEnv({ serviceRole: true });
  const threads = threadStoreFromEnv({ serviceRole: true });

  try {
    switch (body.action) {
      case "dispatch": {
        if (!body.instruction?.trim()) return Response.json({ error: "instruction required" }, { status: 400 });
        const runId = mintRunId();
        const threadId = mintThreadId();
        const { apiIdentifier, messageApiId } = await transport.dispatch(body.instruction);
        await threads.insert({
          id: threadId, medium: "written", transport: TRANSPORT,
          apiIdentifier, runId, topicId: null,
        });
        await ledger.append({
          runId, threadId, source: "edmini", kind: "task_dispatch",
          payload: { instruction: body.instruction, label: body.label ?? null,
                     prevRunId: body.prevRunId ?? null, apiIdentifier: messageApiId },
        });
        return Response.json({ runId });
      }
      case "answer": {
        if (!body.runId || !body.text?.trim()) return Response.json({ error: "runId and text required" }, { status: 400 });
        const apiId = await resolveApiIdentifier(threads, body.runId);
        await transport.answer(apiId, body.text);
        const thr = await threads.byRunId(body.runId);
        await ledger.append({ runId: body.runId, threadId: thr?.id ?? null, source: "edmini", kind: "answer", payload: { text: body.text } });
        return Response.json({ ok: true });
      }
      case "cancel": {
        if (!body.runId) return Response.json({ error: "runId required" }, { status: 400 });
        const apiId = await resolveApiIdentifier(threads, body.runId);
        await transport.cancel(apiId, body.reason);
        const thr = await threads.byRunId(body.runId);
        await ledger.append({ runId: body.runId, threadId: thr?.id ?? null, source: "edmini", kind: "cancel", payload: { reason: body.reason ?? null } });
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** runId -> transport handle, with legacy fallback (pre-shd runId IS the snowflake). */
async function resolveApiIdentifier(threads: ReturnType<typeof threadStoreFromEnv>, runId: string): Promise<string> {
  const thr = await threads.byRunId(runId);
  return thr?.apiIdentifier ?? runId; // legacy: runId was the Discord thread id
}
```

- [ ] **Step 2: Update the route test**

In `src/app/api/bus/__tests__/route.test.ts`: the dispatch response is now `{ runId: "run_…" }` (a minted id, not the Discord thread id). Mock `transport.dispatch` → `{ apiIdentifier, messageApiId }`, mock `threadStoreFromEnv`/`ledgerFromEnv`, and assert (a) `threads.insert` called with `medium:"written"`, the minted `runId`, and the transport `apiIdentifier`; (b) the `task_dispatch` ledger event carries `threadId` + `payload.prevRunId`. For answer/cancel, assert `transport.answer`/`cancel` receives the resolved `apiIdentifier`.

- [ ] **Step 3: Run → pass**

Run: `pnpm test src/app/api/bus/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/bus/route.ts src/app/api/bus/__tests__/route.test.ts
git commit -m "feat(shd): /api/bus mints run_/thr_ ids, writes threads row, resolves answer/cancel [edmini-shd]"
```

---

## Group 4 — Worker inbound resolution

### Task 9: Worker resolves `api_identifier → {threadId, runId}` (cache + retry + legacy)

**Files:**
- Create: `worker/resolve-run.ts` (pure-ish resolver with injectable store + clock, unit-testable)
- Modify: `worker/index.ts`
- Test: `worker/__tests__/resolve-run.test.ts`

> **Race note (spec §"Worker resolution"):** the worker can see a Discord message before `/api/bus`
> writes the `threads` row. We implement **mechanism (a): table query + in-memory cache + brief retry**,
> with **legacy fallback** (`api_identifier == run_id`). Mechanism (b) (embed a marker in the dispatch
> message) stays documented as the fallback if the race proves annoying.

- [ ] **Step 1: Write the failing test**

```ts
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
    expect(s.byApiIdentifier).toHaveBeenCalledTimes(1); // cached
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
```

- [ ] **Step 2: Run → fail**

Run: `pnpm test worker/__tests__/resolve-run.test.ts`
Expected: FAIL ("Cannot find module '../resolve-run'").

- [ ] **Step 3: Implement `worker/resolve-run.ts`**

```ts
import type { ThreadStore } from "../src/lib/threads";
import { legacyThreadFor } from "../src/lib/threads";

export interface ResolvedRun { threadId: string; runId: string | null; }

export interface RunResolverDeps {
  store: ThreadStore;
  transport: string;
  retries?: number;                       // extra attempts on a miss (race window)
  sleep?: (ms: number) => Promise<void>;  // injectable for tests
  delayMs?: number;
}

/**
 * Resolve a transport handle (e.g. Discord thread id) to our {threadId, runId} for ledger writes.
 * Cache hits avoid all I/O. On a miss we retry briefly (the /api/bus threads-row write may not have
 * landed yet), then fall back to legacy (the handle IS the runId for pre-shd runs).
 */
export function createRunResolver(deps: RunResolverDeps) {
  const { store, transport, retries = 3, delayMs = 300 } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const cache = new Map<string, ResolvedRun>();

  return {
    async resolve(apiIdentifier: string): Promise<ResolvedRun> {
      const cached = cache.get(apiIdentifier);
      if (cached) return cached;
      for (let attempt = 0; attempt <= retries; attempt++) {
        const thr = await store.byApiIdentifier(transport, apiIdentifier);
        if (thr) {
          const resolved = { threadId: thr.id, runId: thr.runId };
          cache.set(apiIdentifier, resolved);
          return resolved;
        }
        if (attempt < retries) await sleep(delayMs);
      }
      const legacy = legacyThreadFor(transport, apiIdentifier);
      const resolved = { threadId: legacy.id, runId: legacy.runId };
      cache.set(apiIdentifier, resolved);
      return resolved;
    },
  };
}
```

- [ ] **Step 4: Run → pass**

Run: `pnpm test worker/__tests__/resolve-run.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `worker/index.ts`**

Add imports and a module-level resolver; in `onMessage`, replace `const runId = busRunId(msg)` usage so events carry our ids. `busRunId` now yields the **transport handle**; rename it `busApiIdentifier`. Then resolve:

```ts
import { threadStoreFromEnv } from "../src/lib/threads";
import { createRunResolver } from "./resolve-run";

const TRANSPORT = "discord";
const resolver = createRunResolver({ store: threadStoreFromEnv({ serviceRole: true }), transport: TRANSPORT });

// rename busRunId -> busApiIdentifier (same body; it returns the Discord thread/channel id)

async function onMessage(msg: Message): Promise<void> {
  const apiIdentifier = busApiIdentifier(msg);
  if (!apiIdentifier) return;
  const { threadId, runId } = await resolver.resolve(apiIdentifier);

  const isHarness = msg.author.username === HERMES_USERNAME;
  const source = isHarness ? "harness" : msg.author.bot ? "edmini" : "user";

  try {
    await ledger.append({
      runId, threadId, source, kind: "discord_message",
      payload: { text: msg.content, author: msg.author.username, apiIdentifier: msg.id },
    });
    if (isHarness && msg.content.trim()) {
      const r = await interpret(msg.content, llm);
      console.log(`[worker] ${runId} harness → ${r.kind} (${r.via})`);
      if (r.kind !== "ignore") {
        await ledger.append({
          runId, threadId, source: "harness", kind: r.kind,
          payload: { ...r.payload, via: r.via, confidence: r.confidence },
        });
      }
    }
  } catch (err) {
    console.error(`[worker] failed handling message ${msg.id}:`, err instanceof Error ? err.message : err);
  }
}
```

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm exec tsc --noEmit && pnpm test worker/__tests__/resolve-run.test.ts
git add worker/resolve-run.ts worker/index.ts worker/__tests__/resolve-run.test.ts
git commit -m "feat(shd): worker resolves api_identifier -> {threadId,runId} (cache+retry+legacy) [edmini-shd]"
```

---

## Group 5 — Voice-thread recording

### Task 10: `/api/threads` — record a thread (service-role)

**Files:**
- Create: `src/app/api/threads/route.ts`

> The `/api/threads/*` namespace is free after Group 1's rename. This route lets the browser (anon key,
> can't write threads) record its `voice` thread via a service-role write — mirrors `/api/voice-output`.

- [ ] **Step 1: Implement the route**

```ts
/**
 * Thread registration (edmini-shd) — service-role write of a conversation-locus row. The browser holds
 * only the anon key; the voice client POSTs here to record its voice thread at session start.
 */
import { threadStoreFromEnv, type ThreadMedium } from "@/lib/threads";
import { mintThreadId } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: { medium?: ThreadMedium; transport?: string; apiIdentifier?: string; runId?: string | null };
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  if (body.medium !== "voice" && body.medium !== "written") return Response.json({ error: "medium must be voice|written" }, { status: 400 });
  if (!body.transport || !body.apiIdentifier) return Response.json({ error: "transport and apiIdentifier required" }, { status: 400 });

  try {
    const threads = threadStoreFromEnv({ serviceRole: true });
    const thread = await threads.insert({
      id: mintThreadId(), medium: body.medium, transport: body.transport,
      apiIdentifier: body.apiIdentifier, runId: body.runId ?? null, topicId: null,
    });
    return Response.json({ threadId: thread.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/app/api/threads/route.ts
git commit -m "feat(shd): /api/threads — record a conversation-locus thread [edmini-shd]"
```

### Task 11: Record the voice thread in `VoiceAgent`

**Files:**
- Modify: `src/components/VoiceAgent.tsx` (`startSession`)

- [ ] **Step 1: Add a ref + recorder**

Near the other refs, add `const voiceThreadIdRef = useRef<string | null>(null);`. Add a recorder callback:
```ts
const recordVoiceThread = useCallback(async (sessionId: string) => {
  try {
    const res = await fetch("/api/threads", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ medium: "voice", transport: "openai-realtime", apiIdentifier: sessionId, runId: null }),
    });
    if (res.ok) voiceThreadIdRef.current = (await res.json()).threadId as string;
  } catch { /* non-blocking */ }
}, []);
```

- [ ] **Step 2: Call it at session start**

In `startSession`, right after `sessionIdRef.current = newSessionId;`, add `void recordVoiceThread(newSessionId);`. Add `recordVoiceThread` to `startSession`'s dependency array. In `stopSession`, add `voiceThreadIdRef.current = null;`.

- [ ] **Step 3: Typecheck + build + commit**

```bash
pnpm exec tsc --noEmit && pnpm build
git add src/components/VoiceAgent.tsx
git commit -m "feat(shd): record the voice session as a voice thread [edmini-shd]"
```

> Note: tagging `voice_output`/`user_utterance` events with `voiceThreadIdRef` is part of **`iee`**
> (those routes/log-paths are added there). `shd` only records the thread; `iee` consumes `threadId`.

---

## Group 6 — Back-compat

**Backfill dropped** — the prototype DB is wiped in Task 3 (Step 2), so there are no pre-shd snowflake
runs to migrate. The runtime **legacy fallback** in Task 6 (`legacyThreadFor`) and Task 9 (resolver) is
retained as cheap belt-and-suspenders robustness (it simply never fires on a clean DB). No task here.

---

## Final verification (whole feature)

- [ ] **Unit:** `pnpm test` — all green (ids, threads, ledger threadId, resolver, transport, bus route).
- [ ] **Typecheck/lint/build:** `pnpm exec tsc --noEmit && pnpm lint && pnpm build` — clean.
- [ ] **Live (deploy app + Fly worker):**
  - Dispatch a task by voice → a `threads` row exists (`thr_…`, written, discord) with `run_id` = `run_…`; the `task_dispatch` event carries `threadId` + `payload.prevRunId`.
  - Executor (Hermes) replies → worker writes the event with the **minted** `run_id`/`thread_id` (resolved from the Discord thread), and it narrates (no drop).
  - Answer/cancel by voice → reaches the correct Discord thread (resolved `run_id → api_identifier`).
  - Start a voice session → a `voice` thread row exists (`transport: openai-realtime`).
  - Deep-link: a `discord_message` event's `payload.apiIdentifier` + its thread's `api_identifier` build a valid Discord message URL.
  - (Legacy fallback is dead code on a wiped DB — no live check needed.)
- [ ] **Close-out:** `bd close edmini-shd --reason "…"` + `bd label add edmini-shd needs-verification`; this unblocks `edmini-iee` and `edmini-zo8`.

## Worker deploy reminder

After worker changes land: `fly deploy --app edmini-bus-worker --ha=false` (re-run `fly auth login` first if the post-deploy smoke-check 401s). Confirm the machine is `started` and logs show "ready … tapping bus". It's the SOLE tap — don't also run the Mac worker.
