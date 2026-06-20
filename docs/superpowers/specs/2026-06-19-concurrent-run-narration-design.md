# Concurrent Run Narration — Design Spec

**Date:** 2026-06-19
**Beads:** `edmini-9ex` (feature, under epic `edmini-orm`)
**Status:** approved, pending implementation plan
**Supersedes:** the one-active-run cap shipped in `edmini-fw5` part 2 (commit `fcaf456`)

## 1. Why

`fw5` part 2 rewired the voice layer to supervise **one** run at a time: a single
`activeRunId`, with any ledger event for a different run silently ignored. The stated
justification — "voice is serial, therefore one active run" — conflated two independent things:

- **The edmini↔user channel is serial.** Audio I/O is one stream; turns are sequential. A single
  utterance can still *reference* several runs ("approve the export and cancel the research one").
- **The edmini↔executor channel has no such limit.** It is bus/API calls — fully concurrent.

Seriality constrains **output multiplexing** (edmini speaks one thing at a time), not **run
cardinality**. The real problem voice imposes is: when updates from many runs contend for one
output channel, edmini needs a policy for *what to narrate when*. One-active-run "solved" that by
making the policy trivial — a scope cut, not a property of the medium.

The backend has been concurrent all along (ledger keyed by `runId`, a Discord thread per task, a
worker tapping all threads). The single-run limit lived **entirely** in the voice client. This
design lifts it: edmini supervises N concurrent runs and narrates all of them under an explicit
priority policy.

## 2. Decisions (resolved with the user)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Run concurrency | **Full concurrent narration** — N runs, all narrated by priority |
| 2 | Addressing | **Human-friendly labels** the model assigns and reuses |
| 3 | Narration policy | **Priority + never interrupt the user**, batch near-simultaneous items |
| 4 | Label persistence | **Persist in the `task_dispatch` ledger payload**; registry = cache |
| 5 | Invoker role (future) | Keep narration queue **source-agnostic**; build nothing now |

## 3. Tools & addressing

The model owns the label. It has the natural-language instruction, so it names the run and reuses
that name in every subsequent reference. Raw `runId`s (Discord thread snowflakes) stay internal and
are never spoken.

- **`delegate_task(instruction, label)`** — `label` is a short handle the model picks (`"export"`,
  `"research"`). Returns `{ runId, label }`. The client records the `runId ⇄ label` mapping.
  **Collision rule:** if `label` is already held by a *live* run, the client appends a numeric
  suffix and returns the canonical label (`"export-2"`), so the model re-syncs to what was actually
  stored. The canonical label is what gets persisted.
- **`answer_run(label, text)`** — resolve `label → runId`, `POST /api/bus {action:"answer"}`.
- **`cancel_run(label, reason?)`** — resolve `label → runId`, `POST /api/bus {action:"cancel"}`.
- Unknown / ambiguous label → tool-result error the model relays naturally ("I don't have a run
  called export").

There is no "active run" concept anymore — labels replace it. Pronoun resolution ("cancel that")
remains the model's job from conversation context; it maps the pronoun to a label it already knows.

**Session instructions** (in `/api/session`) updated: multiple runs may be live at once; give each a
distinct short label and reuse it; background updates arrive tagged with the run's label — relay
them naturally and never say the raw id.

## 4. Label persistence (ledger as system of record)

`/api/bus`'s `dispatch` already writes a `task_dispatch` ledger event. We extend its body and
payload with the canonical `label`:

```
POST /api/bus { action: "dispatch", instruction, label }
  → transport.dispatch(instruction) → { runId }
  → ledger.append({ runId, source:"edmini", kind:"task_dispatch",
                    payload: { instruction, label } })   // label added
```

Consequences:

- The in-memory run registry stops being the source of truth and becomes a **cache/projection**
  over the ledger — the same relationship the SQL `runs` view has to `events`.
- "Rehydrate live runs on reload" moves from *needs new storage* to *a ledger query*
  (`task_dispatch` events whose run has no terminal `run_done`/`run_failed`). **Deferred** for v1,
  but the data exists from day one, so it is re-addable without rework.
- Collision resolution stays **client-side** for single-user v1. Server-side label authority and a
  hot-path cache (e.g. Redis) are future optimizations of the *cache*, not changes to the *record*.

This spec implements the **write** side (persist the label) now; the **read/rehydrate** side is
explicitly out of scope.

## 5. Client modules

Two small, **pure, unit-testable** modules mirror the existing `ledger.ts` (pure core) /
`ledger-supabase.ts` (thin binding) split. `VoiceAgent.tsx` wires them to the data channel.

### 5.1 `src/lib/voice/run-registry.ts`
A `Map<runId, { label: string; status: RunStatus }>` plus:
- `register(runId, requestedLabel): string` — applies the collision-suffix rule, stores, returns
  the canonical label.
- `resolveLabel(label): runId | null`
- `labelFor(runId): string | null`
- `setStatus(runId, status)`, `remove(runId)`, `has(runId)`

Pure data structure; no I/O, no React. Fully unit-tested (resolution, collisions, removal).

### 5.2 `src/lib/voice/narration-queue.ts`
**Source-agnostic** by design (this is the invoker-role hook). Items:

```ts
type Priority = "high" | "low";
interface NarrationItem {
  priority: Priority;          // high = run_blocked|run_failed; low = run_output|run_done
  kind: string;                // ledger kind, for compose/labelling
  text: string;                // human-readable summary
  label?: string;              // run label when run-scoped; absent for future run-less events
}
```

API:
- `enqueue(item): void`
- `drain(canSpeak: boolean): Batch | null` — returns the highest-priority ready batch (all queued
  `high` items, else all `low` items) **only when `canSpeak` is true**, removing them from the
  queue; otherwise `null`. Collapses multiple items into one batch so they become a single
  utterance.
- `isEmpty(): boolean`

The queue knows nothing about runs, the ledger, or React — making it trivially testable (priority
ordering, batching, gating) and making a future "invoker" producer a drop-in second `enqueue`
caller.

## 6. Inbound data flow

```
ledger INSERT (Realtime)
  → handleLedgerEvent(event)
      ├─ ignore unless source === "harness" and kind ∈ NARRATE_KINDS
      ├─ label = registry.labelFor(event.runId); if null → skip   // not a run we dispatched
      ├─ enqueue({ priority, kind, text: summary(event), label })
      ├─ if kind ∈ {run_done, run_failed}: registry.remove(runId) // after enqueue
      └─ tryDrain()
```

`tryDrain()` calls `queue.drain(canSpeak())`. **`canSpeak()`** = data channel open **AND** user not
speaking **AND** no response in progress. A returned batch becomes one injected
`conversation.item.create` (user-role framing) + `response.create`, e.g.:

> (System update — relay naturally; do not read verbatim. Run 'export': failed — disk full. Run
> 'research': asking — include Q3?)

`tryDrain()` is re-triggered at three moments so nothing stalls:
1. on every `enqueue` (fire immediately if idle),
2. on `response.done` (edmini just finished speaking),
3. on `input_audio_buffer.speech_stopped` (the user just finished).

## 7. Component state (`VoiceAgent.tsx`)

New refs:
- `runRegistryRef` — the registry instance.
- `narrationQueueRef` — the queue instance.
- `userSpeakingRef` — set true on `speech_started`, false on `speech_stopped`.
- `responseActiveRef` — set true when we send `response.create` / model audio begins, false on
  `response.done`. **Required**: firing `response.create` while a response is active raises
  "conversation already has an active response"; the single-run code never hit this because it fired
  one response per tool result, but concurrent narration will.

`dispatchToolCall` rewrites:
- `delegate_task` → registry.register(runId, label) after the bus returns; pass canonical `label`
  in the dispatch body so it is persisted.
- `answer_run` / `cancel_run` → `registry.resolveLabel(label)`; error tool-result if unknown.

`stopSession` clears the registry, the queue, and unsubscribes the ledger channel (already wired).

## 8. Error handling

- **Unknown/ambiguous label** → structured tool-result error; the model relays it.
- **Bus failure** → existing pattern (tool-result `{ error }`).
- **Narration injection** while not idle → not an error; the item stays queued and drains on the
  next trigger.
- **Event for an unknown run** (no registry entry — e.g. dispatched in a prior session) → skipped in
  v1. Rehydration (§4) would make these resolvable later.

## 9. Testing

- `run-registry` unit tests: register/resolve/labelFor, collision suffixing, removal.
- `narration-queue` unit tests: priority selection, batching of simultaneous items, `canSpeak`
  gating (no drain when false), empty behaviour.
- `/api/bus` route test: `dispatch` persists `label` in the `task_dispatch` payload.
- Component wiring (refs, data-channel sends, idle gating) is verified in the **live voice test**:
  dispatch two tasks with distinct labels, confirm both narrate, a blocking question jumps ahead of
  a chatty output update, and neither interrupts the user mid-sentence.

## 10. Out of scope (v1)

- Registry rehydration from the ledger on reload (write side only is in scope).
- The **invoker** inbound role (email/IoT/webhook → run-less narration). The queue is kept
  source-agnostic so it slots in later as a second producer; no ledger `source` enum change now (an
  additive CHECK-constraint migration when it is actually built).
- Any hard cap on concurrent runs (the batching queue self-limits chatter).
- Redis / server-side label authority (future cache optimizations).
