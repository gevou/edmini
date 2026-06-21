# Session Memory — Rehydration, History & Catch-up — Design Spec

**Date:** 2026-06-20 · **Status:** approved-pending-review · **Bead:** `edmini-iee`
**Relates:** `edmini-9ex` (run registry / labels) · `edmini-rv9` (voice_output ledger) ·
`edmini-mb0` (labels persisted in `task_dispatch`) · open-problems.md (run-as-stream)
**Recommended prerequisite:** `edmini-shd` (channel-agnostic run identity) — so provenance edges land
on the final id-space (see Identity note below). `iee` is id-agnostic, so this is sequencing, not a hard block.
**Defers to follow-up:** chain *consume* (Ed walking lineage); full graph memory

## Context

A voice session has **no memory**. The Realtime system prompt only receives
`getSystemPromptContext()` (the local `/tmp` thread store), never the ledger's run/conversation
history; the run registry is per-session (`createRunRegistry()` on every `startSession`, reset on
`stopSession`) with no rehydration. This causes three concrete failures:

- **(a) No conversational memory.** Ed has zero context of past turns or runs across reloads/sessions.
- **(b) Cross-session events are dropped.** `handleLedgerEvent` does `registry.labelFor(runId)` →
  `null` → `return` for any run not dispatched *in this session*. A genuine answer/result for a
  pre-reload or cross-session run never narrates.
- **(c) Audio-off deliveries are missed.** On `stopSession` the ledger subscription unsubscribes and
  the registry resets; a fresh session only sees *future* events. Anything an executor delivered
  while audio was off sits in the ledger but never reaches the User.

The ledger was built to make all of this free (it's the system of record); the client simply never
reads it back. This spec closes that loop.

One gap surfaced while scoping: **the ledger has Ed's side (`voice_output`) and run events, but never
the User's utterances** — those live only in the ephemeral `/tmp/ed-threads.json`. So "the system of
record" is currently missing half the conversation. We fix that here (it's also what makes message↔run
edges possible later).

## Identity & provenance model (the foundation)

This is the conceptual core; everything else is mechanism.

- **`runId` is identity — an opaque token.** `iee` never parses it or assumes a transport. Today it
  happens to be the Discord thread snowflake; `edmini-shd` makes it a UUID we mint, with the transport's
  native id stored as `api_identifier` (+ a `transport` discriminator). Because `iee` treats `runId` as
  opaque, that refactor is orthogonal to this spec's correctness. The **label is a human-friendly
  *alias* that points at the *head* (latest run) of a chain** — not an identifier and not (yet) a topic.
- **Provenance is an edge in the ledger.** A `task_dispatch` carries an optional **`prevRunId`** —
  the run this one continues. Reusing a label = "this continues that topic" → the new run links to the
  prior head via `prevRunId`, and the label re-points to the new head. The old run stays addressable
  for late-event delivery (fixes **(b)** for *all* history), it just no longer owns the bare label.
- **Lineage is walkable** by following `prevRunId → prevRunId → …` through the ledger. We **write**
  this edge now; **consuming** it (Ed tracing lineage for provenance) is a deferred follow-up.

### How Ed picks the label (why implicit chaining is reliable)

Implicit chaining ("reuse a label ⇒ chain") only works if Ed reuses labels *deliberately* — and the
two things that make that true are the heart of this spec:

1. **Rehydration puts the live labels into Ed's context** (system prompt lists active runs/topics by
   label + a one-line state). Ed can now *see* that `export` exists.
2. **Reference resolution Ed already does.** "Re-run *that* export" → Ed maps the reference to a known
   label, exactly as it already must for `answer_run`/`cancel_run`.
3. **One prompt line:** *"When the User continues or refers to an existing task, reuse that task's
   label; invent a new label only for genuinely new work."*

So reuse becomes an informed, deliberate reference that the system turns into a `prevRunId` edge — not
a string coincidence. No `continues` parameter is added; the single `label` already says it. The
collision-suffix (`export-2`) is **removed** — it was a workaround for not having chaining.

**Known limitation (accepted):** two genuinely *concurrent, unrelated* runs that Ed labels the same
will be chained as predecessor/successor rather than siblings. The prompt tells Ed to pick distinct
labels for distinct concurrent work, so this is rare; the consume side and richer labeling fix it
later. Better to under-engineer than to add a redundant `continues` arg now.

### Mapping to future graph memory

The chain is the **linear special case** of the graph — same nodes, same edges, fewer of them:

| Now (chain) | Future (graph) | What changes |
|---|---|---|
| `runId` = identity, `label` = alias | nodes have stable ids; labels are props | nothing — already aligned |
| `prevRunId` (one parent) | N parents/children (merge / fork) | relax "one predecessor" |
| label → chain *head* | label → entry node of a topic subgraph | "head" → "most-recent/relevant node" |
| `projectRuns(events)` | `projectGraph(events)` | richer reducer, same append-only substrate |

Forward-compat seams respected now so nothing is thrown away:

- Provenance lives in the **event payload** (schemaless JSON): `prevRunId` (scalar) → `prevRunIds`
  (array) → typed edges is a non-breaking projection change, never a migration.
- **Defer the walk logic** — no consumer hardens a "follow exactly one parent" assumption.
- Edge **typing** rides the existing `kind`/`source` fields; `"continues"` is simply the first type.
- **Message nodes arrive in this iteration** (User-utterance logging), so message→run causal edges are
  available for free later.

## Design

### 1. Registry rehydration (fixes b)

On `startSession`, before connecting, read a ledger snapshot (client anon key) and replay it into a
fresh registry:

- Build `runId → label` from `task_dispatch` payloads; replay dispatches **in `seq` order** through
  `registry.register(runId, label)`. With chaining, label reuse re-points the head, so the head ends
  up = latest run per label automatically.
- Set each run's status from `projectRuns` (`lastRunKind` → `active|blocked|done|failed`).
- Store each entry's `prevRunId` (from the payload) on the registry entry for later consume.
- **Scope: keep all (default).** Per the decision, rehydrate **all** `task_dispatch` runs so any of
  them can still deliver late events. Identity-on-`runId` makes a stale label chaining onto a new run
  harmless (not a collision), so there's no correctness reason to drop old runs. A configurable upper
  bound exists only as a future safety valve if the snapshot ever grows large; it is **off by default**.

`registry.register` changes: on an existing base label, **chain** (link `prevRunId` = current head,
re-point head to the new runId) instead of suffixing. `labelFor(oldRunId)` still returns the base label
(its late events still narrate correctly); `resolveLabel(base)` returns the head.

### 2. History context into the system prompt (fixes a)

`/api/session` (server, service-role) builds history from the ledger at session-create time — no
client change needed:

- **Recent runs:** `projectRuns(snapshot)` annotated with labels (from `task_dispatch`) → compact
  lines: `export (done) — last: "finished: 400"`.
- **Recent conversation:** interleave `user` utterances + `voice_output` (Ed) by `seq`, last *K* turns.
- Inject as a `## Recent history` block in `instructions`, alongside the existing thread context.

**User-utterance logging (the missing half):** the client logs each finalized User transcript
(`conversation.item.input_audio_transcription.completed`) to the ledger as
`{ source: "user", kind: "user_utterance", payload: { text } }` via a new
`/api/conversation/utterance` route (parallel to `/api/voice-output`, service-role write). This makes
the ledger the complete conversation record and creates the message nodes for future edges.

### 3. Catch-up on resume (fixes c)

- Persist **`lastSeenSeq`** in `localStorage`. Updated as live events arrive and on `stopSession`.
- On `startSession`, after rehydration: from the same snapshot, take **narratable harness events**
  (`run_done|run_blocked|run_failed|run_output`) with `seq > lastSeenSeq` for registry runs → compose a
  single **"while you were away"** batch and **proactively speak it** once the data channel opens
  (via `injectNarration` with a catch-up framing prefix). Empty → say nothing.
- **First-ever session** (no `lastSeenSeq`): no catch-up (history goes into the prompt instead).

### Dedup / race handling

Maintain `lastProcessedSeqRef`. Rehydration sets it to the snapshot's max `seq`. `handleLedgerEvent`
**ignores any event with `seq ≤ lastProcessedSeqRef`** and advances it otherwise. This makes the
snapshot→subscribe handoff idempotent (a live event already in the snapshot is dropped) and is what
persists into `lastSeenSeq`.

## Components

- **`src/lib/voice/run-registry.ts`** (change + tests): chaining `register` (reuse → link
  `prevRunId`, re-point head; no suffix); store `prevRunId` per entry; a `rehydrate(events)` helper or
  a pure `buildRegistryFromEvents(events)` that replays `task_dispatch` + applies `projectRuns` status.
  Keep it pure/dependency-free.
- **`src/lib/ledger.ts`** (small add, pure): `labelsByRun(events)` helper (runId→label from
  `task_dispatch`); optionally a `recentConversation(events, k)` selector for the prompt. Pure + tested.
- **`src/app/api/bus/route.ts`**: `dispatch` accepts optional `prevRunId`; write it into the
  `task_dispatch` payload.
- **`src/app/api/session/route.ts`**: build + inject the `## Recent history` block from a ledger
  snapshot (service-role).
- **`src/app/api/conversation/utterance/route.ts`** (new): service-role write of a `user_utterance`
  event. Mirrors `voice-output`.
- **`src/components/VoiceAgent.tsx`**: on `startSession`, snapshot → rehydrate registry, set
  `lastProcessedSeqRef`, compute + speak catch-up; compute `prevRunId` (current head) before a
  `delegate_task` bus call and pass it; `handleLedgerEvent` seq-dedup + advance `lastSeenSeq`; log User
  utterances; persist `lastSeenSeq` on `stopSession`.

## Data flow

```
startSession
  → /api/session POST  ── server snapshots ledger → injects "Recent history" into instructions
  → client snapshot() (anon, all events by default)
       → buildRegistryFromEvents → fresh registry (labels=heads, statuses, prevRunId)
       → lastProcessedSeq = max(seq); catch-up = narratable events (seq > lastSeenSeq)
  → subscribe(handleLedgerEvent)         (live; seq-dedup vs lastProcessedSeq)
  → SDP / connect
  → on data-channel open: injectNarration(catch-up batch)   ("while you were away …")

delegate_task(label) → prevRunId = registry.resolveLabel(label) ?? null
  → /api/bus dispatch {instruction,label,prevRunId} → task_dispatch{…,prevRunId}
  → registry.register(runId,label)  (re-points head, links prevRunId)

User utterance finalized → /api/conversation/utterance → user_utterance event
Ed utterance finalized   → /api/voice-output           → voice_output event   (unchanged)
```

## Error handling

- Snapshot/rehydrate failure must **not** block the session: log to the event log, start with an empty
  registry (degrades to today's behaviour). Same fire-and-forget posture as `voice-output`.
- Catch-up framing reuses the faithfulness rules: relay only what events say; "reported" = progress.
- RLS: the **anon key must permit `select` on `events`** for the client snapshot (Realtime already
  reads it). Verify; if blocked, route the snapshot through a service-role API instead.

## Testing / Verification

- **Unit (pure):** `buildRegistryFromEvents` (chaining heads, prevRunId, status from projectRuns;
  reuse re-points head and old run stays `labelFor`-addressable); `labelsByRun`; conversation selector.
- **Unit:** `register` chaining semantics (reuse links + re-points; no suffix).
- **Live:** (b) dispatch a run, reload, have the executor reply → it narrates (not dropped). (c)
  dispatch, stop audio, let executor finish, resume → Ed says "while you were away…". (a) ask "what
  were we doing" after reload → Ed recalls from history. tsc/build/lint + existing tests green.

## Out of scope (follow-up beads)

- **Chain consume:** a `trace_run`/lineage capability + prompt guidance for Ed to walk provenance.
- **Full graph memory:** `projectGraph`, multi-parent edges, typed nodes/edges, topic clustering.
- **`continues` param / sibling-vs-chain disambiguation** (only if implicit collisions bite).
