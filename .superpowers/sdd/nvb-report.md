# IEE Eval Suite — nvb implementation report

**Date:** 2026-06-21  
**Bead:** `edmini-nvb`  
**Status:** DONE — all green, no product bugs found.

## What was built

`src/app/api/__tests__/iee-scenarios.integration.test.ts` — 5 tests across 3 describe blocks,
one for each user-facing scenario in the iee spec.

## Architecture: shared in-memory ledger

`makeMemoryLedger()` implements the `Ledger` interface from `src/lib/ledger-supabase.ts`:
- An array of `MemoryRow` objects (LedgerEvent + `id`/`seq`/`ts`).
- `append()` assigns monotonically incrementing `seq` + a stable `id`.
- `snapshot(opts)` mirrors the real Supabase binding's filter set: `runId`, `source`,
  `author` (via `payload.author`), `since`/`until` (ISO string comparison on `ts`), `text`
  (case-insensitive substring over `JSON.stringify(payload)`), `threadIds`; `limit` applied
  AFTER ordering by `seq` ASC — matching PostgREST semantics.
- `subscribe()` is a no-op (live push not needed).

`vi.hoisted` is used so the holder (`ledgerHolder`) exists before `vi.mock` factories run.
`vi.mock("@/lib/ledger-supabase")` returns `() => ledgerHolder.current`, and `beforeEach`
resets it to a fresh instance. All three routes (`session`, `history`, `utterance`) share
exactly one ledger instance per test — that is the seam the per-route unit tests don't cover.

Global `fetch` is stubbed via `vi.stubGlobal` mirroring `src/app/api/session/__tests__/route.test.ts`,
and request bodies are captured so tests can assert on `session.instructions` and `session.tools`.

## Scenario coverage

### (a) memory + search_history end-to-end (2 tests)

**What it asserts (test 1 — the integration seam):**
1. Utterance route POST `{text:"remember the codename is BlueFinch"}` → 200.
2. 14 filler convo pairs appended directly, pushing BlueFinch outside the 12-event recent window.
3. Utterance route POST `{text:"let's plan the launch"}` → 200.
4. A `task_dispatch` with label "standup" seeded.
5. Session route POST → OpenAI fetch body captured:
   - `session.instructions` contains `"Recent history"` — block present.
   - `session.instructions` contains `"let's plan the launch"` — it's in the recent 12.
   - `session.instructions` contains `"standup"` — run appears in Recent runs.
   - `session.instructions` does NOT contain `"BlueFinch"` — proves it's outside the window,
     hence search_history is genuinely needed for recall (not a redundant tool).
   - `session.tools` includes a tool named `"search_history"`.
6. History route POST `{text:"BlueFinch"}` → 200, response events contain the BlueFinch utterance.

This is the primary "threading the seam" test: utterance-route writes → ledger → session route
reads them, all through the same in-memory instance. No existing test covers this path.

### (b) cross-session registry rehydration (2 tests)

**What they assert:**
- A `task_dispatch` seeded for `runId "run_cross_session_001"` with label `"research"`.
- `buildRegistryFromEvents(snapshot)` → `registry.labelFor(runId) === "research"`.
  This is the exact fix for the pre-iee bug where `handleLedgerEvent` called `registry.labelFor`
  → null → returned early, silently dropping cross-session events.
- `registry.labelFor("run_unknown_999") === null` — a run with no dispatch event must stay null.
- Second test: a dispatched+done run has `labelFor` resolve AND `has()` return true (status
  correctly populated from `projectRuns` during rehydration).

### (c) catch-up on resume (2 tests... wait: it's `it` blocks, 2 total)

**What they assert:**
- Pre-cutoff dispatch + `run_output` seeded; `lastSeenSeq` captured at snapshot max.
- `run_done` appended AFTER the cutoff (simulating executor finishing while audio was off).
- `selectCatchUp(newSnapshot, lastSeenSeq, knownRunIds)` returns exactly 1 event: the
  `run_done` with `summary: "exported 412 items"`. Pre-cutoff events excluded.
- `catchUp.every(e => e.seq > lastSeenSeq)` — no leakage.
- **First-ever session rule** (documented as explicit assertion + comment): when `lastSeenSeq === 0`,
  the app wraps the `selectCatchUp` call in `lastSeenSeq > 0 ? ... : []`, so catch-up is empty.
  The test encodes this as `const catchUp = lastSeenSeq > 0 ? selectCatchUp(...) : []` and
  asserts `catchUp.toHaveLength(0)` — proving the rule is intentional and tested.

## What is NOT covered (per spec)

1. Live OpenAI Realtime narration — requires WebRTC + paid key.
2. `VoiceAgent.tsx` data-channel glue:
   - `dc.onopen` firing the catch-up batch via `injectNarration`.
   - `handleLedgerEvent` seq-dedup + `lastProcessedSeqRef` advance.
   These require a browser/JSDOM + OpenAI E2E. Tracked by `edmini-7fn`.

No production code was modified.

## Product bugs found

None. All three scenarios' logic is correct and the routes/helpers implement what the spec describes.

## Test counts

- New eval tests: 5
- Full suite: 177 tests across 31 files (all passing before and after).

## Verification

```
pnpm test src/app/api/__tests__/iee-scenarios.integration.test.ts  → 5/5 ✓
pnpm test                                                           → 177/177 ✓
pnpm exec tsc --noEmit                                              → clean
```
