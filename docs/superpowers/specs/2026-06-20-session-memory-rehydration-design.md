# Session Memory — Rehydration, History & Catch-up — Design Spec

**Date:** 2026-06-20 · **Status:** approved-pending-review · **Bead:** `edmini-iee`
**Depends on:** `edmini-shd` (channel-agnostic identity / thread model) — `iee` reads ids the `shd`
foundation defines (it treats them as opaque).
**Relates:** `edmini-9ex` (run registry / labels) · `edmini-rv9` (voice_output ledger) ·
`edmini-mb0` (labels persisted in `task_dispatch`) · `edmini-qo3` (addressivity → `search_history` `to`) ·
open-problems.md (run-as-stream)
**Defers to the incoming graph memory:** relationship management, retrieval/ranking, lineage walking,
topic clustering (see the design principle below).

## Context

A voice session has **no memory**. The Realtime system prompt only receives
`getSystemPromptContext()` (the local `/tmp` topic store), never the ledger's run/conversation history;
the run registry is per-session (`createRunRegistry()` on every `startSession`, reset on `stopSession`)
with no rehydration. Three concrete failures:

- **(a) No conversational memory.** Ed has zero context of past turns or runs across reloads/sessions.
- **(b) Cross-session events are dropped.** `handleLedgerEvent` does `registry.labelFor(runId)` →
  `null` → `return` for any run not dispatched *in this session*. A genuine answer/result for a
  pre-reload or cross-session run never narrates.
- **(c) Audio-off deliveries are missed.** On `stopSession` the subscription unsubscribes and the
  registry resets; a fresh session only sees *future* events. Anything an executor delivered while
  audio was off sits in the ledger but never reaches the User.

The ledger was built to make this free (it's the system of record); the client just never reads it back.

## Design principle: operational vs. memory (and the incoming graph)

A graph-based memory system is coming **sooner than later** to own edmini's memory. So this spec is
deliberately split, and the memory half is kept minimal so we neither over-build nor design against the
graph:

- **Operational correctness — build now, needed regardless of any memory system.** The live session
  must not *drop messages*: **(b)** rehydrate-for-delivery and **(c)** catch-up-on-resume. This is
  plumbing, not memory.
- **Memory — keep dumb / record raw facts only; the graph owns the rest.** **(a)** history-into-prompt
  is a **disposable stopgap**; **provenance** is recorded as a **raw fact**, with **no management logic**.

**The rule that keeps us graph-compatible:** *record relationships as raw facts in the append-only
ledger; never manage them in bespoke structures.* The graph becomes `projectGraph(events)` — a
projection over the ledger, never a parallel store we have to sync. Stable opaque ids (`edmini-shd`) +
append-only ledger + everything-derivable-from-the-ledger **is** the ideal graph substrate. We'd only
design *against* the graph by building a managed relationship store — which we explicitly do not.

## Identity & provenance

- **`runId` is an opaque token.** `iee` never parses it. Per `edmini-shd` it's a minted `run_<uuid>`;
  the transport-native id lives elsewhere as `api_identifier`. Opaqueness is why `iee` is unaffected by
  the id representation.
- **The `label` is unchanged from today** — a human handle the model assigns at dispatch, suffixed on
  collision (`export-2`). We are **not** adding chaining/topic semantics to the label; that's the
  graph's job.
- **Provenance = a raw recorded fact, no mechanism.** When the client dispatches with a label that
  already resolves in-session, it records `prevRunId = resolveLabel(label)` on the `task_dispatch`
  payload (else null). That's the whole feature: a cheap, high-fidelity edge captured at dispatch time
  for the graph to ingest later. **No head re-pointing, no label-reuse prompt rule, no suffix change,
  no walk logic.** Recording is opportunistic; if it's null, the graph can still infer lineage from the
  conversation.

Why this is graph-ready: the edge lives in schemaless payload (`prevRunId` scalar → `prevRunIds` array
→ typed edges is a non-breaking projection change); message nodes arrive too (User-utterance logging),
so message→run edges are derivable later — all **without** any relationship code shipping now.

## Design

### 1. Registry rehydration — operational (fixes b)

On `startSession`, before connecting, read a ledger snapshot (client anon key) and rebuild the
registry so no known run's events are dropped:

- A pure **`buildRegistryFromEvents(events)`**: replay `task_dispatch` (runId + label) **in `seq`
  order** through the **existing** `register` (suffix-on-collision, unchanged); set each run's status
  from `projectRuns` (`lastRunKind` → `active|blocked|done|failed`).
- **Scope:** rehydrate all `task_dispatch` runs so `labelFor(runId)` is non-null for any run that could
  still emit. (Label-space tidiness over time is a graph-era concern; only recent/active runs surface
  in context anyway — see §3.)

No `register` behaviour change. The only new code is the pure replay helper + calling it at session
start. This alone fixes (b): `handleLedgerEvent` now resolves a label for cross-session runs.

### 2. Catch-up on resume — operational (fixes c)

- Persist **`lastSeenSeq`** in `localStorage`, advanced as live events arrive and on `stopSession`.
- On `startSession`, after rehydration: from the same snapshot take **narratable harness events**
  (`run_done|run_blocked|run_failed|run_output`) with `seq > lastSeenSeq` for registry runs → one
  **"while you were away"** batch, **spoken** once the data channel opens (via `injectNarration` with a
  catch-up framing prefix). Empty → say nothing.
- **First-ever session** (no `lastSeenSeq`): no catch-up.

#### Dedup / race

Maintain `lastProcessedSeqRef`; rehydration sets it to the snapshot's max `seq`. `handleLedgerEvent`
**ignores any event with `seq ≤ lastProcessedSeqRef`** and advances it otherwise — making the
snapshot→subscribe handoff idempotent. This value persists into `lastSeenSeq`.

### 3. History context — shallow default + a retrieval tool (fixes a)

Two parts with different lifespans: a **disposable** passive baseline, and a **durable** active tool
that is the seam the graph plugs into later.

**3a. Shallow default — DISPOSABLE.** `/api/session` (server, service-role) injects a `## Recent
history` block: a dumb **recent-N dump, no scoring** — the last *N* conversation events
(`user_utterance` + `voice_output`, by `seq`) and a flat list of recent runs (`projectRuns` + label).
No ranking/summarization. **Replaced wholesale by graph-driven retrieval** when it lands.

**3b. `search_history` tool — DURABLE (the retrieval seam).** Ed gets a tool to go deeper when a
reference (or an incoming event) seems to point at older history. It's a **thin parametric query over
the ledger, no ranking** — and its *interface* survives into the graph era; only the backend swaps
(ledger query → graph retrieval). Params (Ed sets what it needs):

| Param | Backed by | Notes |
|---|---|---|
| `limit` | now | cap on events returned |
| `runId` / `apiIdentifier` | now | events for one run/thread; **provenance entry point** — Ed reads `prevRunId` from results and re-calls to walk lineage hop-by-hop (no walk code) |
| `since` / `until` | now | date range |
| `text` | now | free-text (ILIKE) over event payloads |
| `channel` | after `shd` | the thread's `transport`/`medium` (voice/discord/slack/api), via `events.thread_id` → `threads` |
| `from` | partial now | coarse sender: `source` (user/edmini/harness) + `payload.author`; richer identity arrives with multi-channel |
| `to` | **deferred → `qo3`** | addressivity isn't captured yet (esp. in voice). Param shape reserved; lands when `qo3` records the addressee — **not** a no-op filter now |

`from`/`to`/`channel` are really **message-node properties** in the eventual graph; recording them as
raw event facts and exposing them as filters lays those attributes the dumb, forward-compatible way.

### 4. User-utterance logging — completes the ledger (operational, pro-graph)

The ledger has Ed's side (`voice_output`) and run events but **never the User's utterances** (they live
only in `/tmp`). The client logs each finalized User transcript
(`conversation.item.input_audio_transcription.completed`) as
`{ source: "user", kind: "user_utterance", payload: { text } }` via a new
`/api/conversation/utterance` route (parallel to `/api/voice-output`, service-role). Cheap raw-fact
recording — makes the ledger the complete conversation record (feeds §3) and creates the message nodes
the graph will use. No retrieval logic.

## Components

- **`src/lib/voice/run-registry.ts`**: **no behaviour change.** Add a pure
  `buildRegistryFromEvents(events)` (replay `task_dispatch` via existing `register`; apply
  `projectRuns` status) + tests. (Optionally store `prevRunId` on the entry — read-only, for the future
  consume; not required.)
- **`src/lib/ledger.ts`** (small, pure): `labelsByRun(events)` (runId→label) and a trivial
  `recentConversation(events, n)` selector. Pure + tested.
- **`src/lib/ledger-supabase.ts`**: extend `snapshot` with the `search_history` filters — `since`/
  `until` (ts or seq), `text` (ILIKE over `payload`), `source`/`author` (`from`), and `channel` (join
  `events.thread_id → threads.transport/medium`, post-`shd`). Keep returning raw events.
- **`src/app/api/bus/route.ts`**: `dispatch` accepts optional `prevRunId`; write it into the
  `task_dispatch` payload. (Raw fact; no other logic.)
- **`src/app/api/session/route.ts`**: inject the dumb `## Recent history` block (service-role
  snapshot); register the `search_history` tool definition in the `tools` array.
- **`src/app/api/history/route.ts`** (new): backs `search_history` — validates params, runs the
  filtered `snapshot`, returns raw events. The graph swaps in here later, behind the same route.
- **`src/app/api/conversation/utterance/route.ts`** (new): service-role write of `user_utterance`.
- **`src/components/VoiceAgent.tsx`**: on `startSession` snapshot → `buildRegistryFromEvents`, set
  `lastProcessedSeqRef`, compute + speak catch-up; record `prevRunId = resolveLabel(label)` before a
  `delegate_task` bus call; handle the `search_history` tool call (→ `/api/history` → `sendToolResult`);
  `handleLedgerEvent` seq-dedup + advance `lastSeenSeq`; log User utterances; persist `lastSeenSeq` on
  `stopSession`.

## Data flow

```
startSession
  → /api/session POST  ── server snapshots ledger → injects dumb "Recent history" into instructions
  → client snapshot() (anon)
       → buildRegistryFromEvents → fresh registry (labels via existing suffix rule, statuses)
       → lastProcessedSeq = max(seq); catch-up = narratable events (seq > lastSeenSeq)
  → subscribe(handleLedgerEvent)         (live; seq-dedup vs lastProcessedSeq)
  → SDP / connect
  → on data-channel open: injectNarration(catch-up batch)   ("while you were away …")

delegate_task(label) → prevRunId = registry.resolveLabel(label) ?? null   (raw fact only)
  → /api/bus dispatch {instruction,label,prevRunId} → task_dispatch{…,prevRunId}
  → registry.register(runId,label)        (existing behaviour, suffix-on-collision)

search_history(params) → /api/history → filtered ledger snapshot → raw events → sendToolResult
  (Ed reads prevRunId in results → re-calls with that id to walk provenance, hop by hop)

User utterance finalized → /api/conversation/utterance → user_utterance event
Ed utterance finalized   → /api/voice-output           → voice_output event   (unchanged)
```

## Error handling

- Snapshot/rehydrate failure must **not** block the session: log it, start with an empty registry
  (degrades to today). Same fire-and-forget posture as `voice-output`.
- Catch-up framing reuses the faithfulness rules: relay only what events say; "reported" = progress.
- RLS: the **anon key must permit `select` on `events`** for the client snapshot (Realtime already
  reads it). Verify; if blocked, route the snapshot through a service-role API.

## Testing / Verification

- **Unit (pure):** `buildRegistryFromEvents` (all runs registered, statuses from `projectRuns`,
  existing suffix-on-collision preserved); `labelsByRun`; `recentConversation`.
- **Unit:** `/api/history` filter behaviour (limit, id, `since`/`until`, `text`, `channel`, `from`);
  unsupported/empty filters degrade gracefully.
- **Live:** (b) dispatch, reload, executor replies → it narrates (not dropped). (c) dispatch, stop
  audio, let executor finish, resume → Ed says "while you were away…". (a) ask "what were we doing"
  after reload → Ed recalls from the dumb history; ask about something older → Ed calls `search_history`
  and recalls it. tsc/build/lint + existing tests green.

## Out of scope

- **Relationship *management* & multi-hop lineage walking** (head re-pointing, `trace_run`, chain
  semantics) — the graph owns these. (Single-hop provenance is free: `prevRunId` fact + `search_history`.)
- **Retrieval *ranking*/summarization** — §3a is a dumb stopgap the graph replaces. (The `search_history`
  *tool* (§3b) is built now and durable; only its backend swaps to the graph.)
- **`to` / addressivity capture** → `edmini-qo3` (the `search_history` `to` param lands then).
- **`projectGraph`, multi-parent/typed edges, topic clustering.**
