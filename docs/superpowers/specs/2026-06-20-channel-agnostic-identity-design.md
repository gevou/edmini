# Channel-Agnostic Identity & the Thread Model — Design Spec

**Date:** 2026-06-20 · **Status:** approved-pending-review · **Bead:** `edmini-shd`
**Blocks:** `edmini-iee` (session memory) · `edmini-zo8` (entities UI panel)
**Relates:** v1-design §4.2 (swappable harness adapter) · §6.2 (swappable voice provider) ·
`edmini-9ex` (run registry / labels)

## Context

Today the **Discord thread snowflake is `runId`** everywhere — the ledger `run_id`, the run registry,
the bus, and the worker all key on it. That couples our system of record to one transport: the day we
add Slack, a direct API, or native agent integration, identity breaks. It also conflates concepts that
are actually distinct, which has been a recurring source of confusion.

This spec mints our own identities, models the conversation **thread** as a first-class,
medium-aware concept, and untangles the vocabulary so nothing downstream (`iee`, `zo8`, the future
graph) inherits the ambiguity.

## Vocabulary (the four layers)

Getting these names right *now* is half the point of this bead.

- **topic** — a *subject grouping* (e.g. "product-launch-planning"). The future graph's clustering
  node. **This is what `thread-manager.ts`'s `Thread` actually is today** (it has `name`/`status`/
  `category`/`summary`) — it is **misnamed** and gets renamed to `Topic` here.
- **thread** (`thr_<uuid>`) — a *conversation locus*: where messages flow. **Medium-aware**
  (`voice` | `written`), with a `transport` and a transport-native handle (`api_identifier`). The
  voice session is a `voice` thread; each executor (Discord) dispatch is a `written` thread. This is
  the cross-cutting concept — edmini's core competency is conversation, and a conversation lives in a
  thread regardless of medium.
- **run** (`run_<uuid>`) — a unit of *delegated work*, conducted *in* a thread. Stays event-sourced.
- **message / event** — a ledger event; happens *in* a thread, optionally tied to a run; carries the
  transport message id as `api_identifier` (enables "jump to *this* message", not just the thread).

Relationship: **topic ⊃ thread (voice|written) ⊃ messages**, with **runs** as work conducted in a
thread. Threads are **not** 1:1 with runs: the voice thread has no run; a Discord run has one thread.

## Identity model

- **Canonical id = a prefixed UUID we mint** — `run_<uuid>`, `thr_<uuid>` (topics keep their existing
  human slugs). Prefixes make ids self-describing in logs and the ledger.
- **`api_identifier` is the uniform name for a transport-native handle** on every object that maps
  outward: a thread's `api_identifier` = the Discord thread id; a message's `api_identifier` = the
  Discord message id. A `transport` discriminator (`"discord"`, `"openai-realtime"`, …) accompanies it.
- We keep the channel-specific id deliberately (not just for translation): **deep-link / jump-to-message,
  recovery, re-reading a thread, inbound processing** all need it. That's why it's a first-class,
  indexed, bidirectionally-queryable field — not buried in a JSONB payload.
- **Casing convention:** `api_identifier` is the canonical field name. SQL **table columns** are
  snake_case (`api_identifier`, `run_id`, `thread_id`, `topic_id`); **TS/JSON payload keys** mirror
  the existing code's camelCase (`apiIdentifier`, `threadId`, `prevRunId`, alongside today's `messageId`,
  `label`, `instruction`). The two forms denote the same field.

## Schema

- **New `threads` table** (Supabase) — the first-class, bidirectional transport map:
  `id text pk (thr_)`, `medium text (voice|written)`, `transport text`, `api_identifier text`,
  `run_id text null` (denormalized for the 1:1 executor case so the worker resolves in one lookup;
  null for voice threads), `topic_id text null` (link deferred), `created_at`. **Index on
  `(transport, api_identifier)`** (inbound `T → thread`) and on `run_id` (outbound `run → thread`).
- **`events`**: add nullable **`thread_id`**; `run_id` stays (now `run_<uuid>`). So voice-side events
  (`user_utterance`, `voice_output`) attach to the voice thread even though they have no run.
- **`runs`**: **no table** — runs stay projected (`projectRuns`). Identity is minted at dispatch and
  written on the `task_dispatch` event (`run_id`, payload `{thread_id, label, prev_run_id, instruction}`).
  A `runs` cache is **backfillable anytime** by replaying the stream, since the ledger is the source.
- **`topics`**: code rename only — `thread-manager.ts` is a `/tmp` JSON store, not in Supabase.

## Layering & interfaces

- **The transport interface speaks `api_identifier`, not `runId`.** A transport knows only external
  handles; it must not know about our identity. `DispatchResult` returns `apiIdentifier` (the created
  thread's handle) + the message handle; `answer(apiIdentifier, text)` / `cancel(apiIdentifier, reason)`.
- **`/api/bus` owns identity and the map.** It mints `run_<uuid>` + `thr_<uuid>`, writes the `threads`
  row, and resolves `run_id ↔ api_identifier` for outbound actions.

## Flows

**Dispatch**
```
/api/bus dispatch
  → mint run_<uuid>, thr_<uuid>
  → transport.dispatch(instruction) → { apiIdentifier: T, messageApiId }
  → insert threads { id: thr_, medium:"written", transport:"discord", api_identifier:T, run_id:run_ }
  → ledger.append(task_dispatch { run_id, payload:{ threadId:thr_, label, prevRunId, instruction,
                                                    apiIdentifier: messageApiId } })
  → return { runId: run_, label }      (registry stores run_; iee provenance unchanged)
```

**Answer / cancel**
```
/api/bus → resolve run_id → threads.run_id → api_identifier(T) → transport.answer(T, text)
```

**Worker (inbound)**
```
Discord message in thread T
  → threads(transport:"discord", api_identifier:T) → { thread_id, run_id }
  → ledger.append({ thread_id, run_id, source, kind, payload:{…, apiIdentifier: msg.id} })
```

**Voice thread**
```
VoiceAgent.startSession
  → record a threads row { thr_, medium:"voice", transport:"openai-realtime", api_identifier: sessionId }
  → voice_output / user_utterance events carry that thread_id
```

### Worker resolution — the one open detail (finalize in spec/spike)

The worker can see a Discord message before `/api/bus` has written the `threads` row (the dispatch
message is posted inside `transport.dispatch`, before the row insert). Two candidate mechanisms, to be
settled by a small spike during implementation:

- **(a) Table query + cache + retry.** Worker looks up `threads(api_identifier=T)` (indexed), caches
  `T → {thread_id, run_id}` in memory, with brief backoff to cover the race. Standard; Discord stays
  clean. Cost: a lookup on first message + race handling.
- **(b) Embed a marker in the dispatch message.** The first (edmini) message in the thread carries a
  machine tag (e.g. `‹edmini-run:run_… thread:thr_…›`) the worker parses → learns the mapping with
  zero queries and **no race** (it's the first message, before any harness reply). Cost: transport-
  specific convention; relies on Hermes ignoring the tag.

Leaning (a) now that `threads` is indexed; (b) stays the fallback if the race proves annoying.

## Topic rename (full reach)

"Earlier than later." Mechanical but broad:

- `src/lib/thread-manager.ts` → `topic-manager.ts` (`Thread`→`Topic`, functions, `/tmp/ed-topics.json`;
  `getSystemPromptContext` unchanged in behaviour).
- `src/lib/classify-thread.ts` → `classify-topic.ts`.
- `src/app/api/threads/*` → `src/app/api/topics/*` (`route.ts`, `[id]/route.ts`, `[id]/message/route.ts`,
  `classify/route.ts`).
- `src/components/VoiceAgent.tsx`: `postTurnToThread` → `postTurnToTopic`; fetch URLs updated.
- Tests referencing the above. After this, **"thread" means only the conversation locus** anywhere in
  the code.

## Back-compat (no event migration)

- Legacy events have `run_id =` snowflake, no `thread_id`, no `threads` row. Resolvers fall back to
  "treat `run_id` as its own `api_identifier`", so old runs still answer/cancel/deep-link.
- **Optional one-time backfill:** insert a `threads` row per historical `task_dispatch`
  (`medium:"written"`, `transport:"discord"`, `api_identifier = run_id`, `run_id = run_id`), making
  history uniform and deep-linkable. Runs cache is likewise backfillable on demand.
- New ids are prefixed; opaque mixed id-spaces coexist (consumers never parse a `runId`).

## Components

- **`infra/supabase/migrations/*`**: `threads` table + indexes; `events.thread_id` column. Update the
  `runs` view if it references `run_id` shape (it stays valid — ids are opaque).
- **`src/lib/threads.ts`** (new): `Thread` type + pure helpers (`buildThread`, id minting,
  `resolveByApiIdentifier`, `resolveApiIdentifier(runId)`); thin Supabase binding mirroring
  `ledger-supabase.ts`.
- **`src/lib/bus/transport.ts` + `discord-transport.ts`**: interface speaks `apiIdentifier`;
  `DispatchResult` returns `{ apiIdentifier, messageApiId }`.
- **`src/app/api/bus/route.ts`**: mint ids, write `threads` row, resolve for answer/cancel.
- **`worker/index.ts`**: resolve `T → {thread_id, run_id}` (mechanism per the spike); write
  `thread_id` + message `api_identifier`.
- **`src/components/VoiceAgent.tsx`**: record the voice thread; topic-rename touch-ups.
- **Topic rename**: the files listed above.

## Phasing (for the implementation plan)

1. **Ids + `threads` table + transport interface** (`apiIdentifier`) + `/api/bus` mints run/thread +
   writes the row + answer/cancel resolve.
2. **Worker resolution** (`T → thread → run`) + race spike (a vs b).
3. **`events.thread_id`** + **voice-thread recording** + attach voice events.
4. **Topic rename** (full reach).
5. **Back-compat fallback** + optional backfill.

## Verification

- **Unit (pure):** thread helpers (mint, resolve both directions, legacy `api_identifier == run_id`
  fallback); dispatch path returns `run_<uuid>` and writes a `threads` row.
- **Live:** dispatch → executor replies → event lands with the correct `run_id`/`thread_id` (worker
  resolved `T`); answer/cancel reach the right Discord thread; a voice turn writes events tagged with
  the voice thread; deep-link from a message's `api_identifier` opens the right Discord message.
  tsc/build/lint + existing tests green.

## Out of scope (follow-up)

- `runs` materialized table / `projectGraph` / topic↔thread linking (the graph) — deferred.
- Non-Discord transports (Slack, direct API, native) — this spec only makes them *possible*.
- The entities UI (`edmini-zo8`) and the session-memory reads (`edmini-iee`) — separate beads built on
  this foundation.
