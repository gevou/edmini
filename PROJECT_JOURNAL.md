# edmini — Development Journal

> A working journal for **edmini**, a voice agent that supervises autonomous executors. It is
> **rich raw material to tell stories from later — not the finished blog post.** Capture the
> specifics: real decisions + reasoning, alternatives, dead ends, surprises, and concrete changes
> (file paths, code snippets, commands, results, diagrams), plus **direct quotes of pivotal dialog**.
> Detail over brevity (don't over-condense); narrative is welcome when it describes something
> specific. Entries dated, newest first. (Style refined 2026-06-19; earlier narrative entries
> archived verbatim in [`docs/journal-archive.md`](docs/journal-archive.md). File-change logs:
> `docs/SESSION_SUMMARIES.md`.)

## Project overview

edmini is a voice-first *supervisor*: it has no task-execution capabilities of its own and instead
coordinates an external agent harness (initially Hermes) on the user's behalf. Its hard problem is
**attention accounting** — protecting a single human's single-stream voice attention across many
asynchronous agent runs, letting the person decide what is *important* while the system computes
only what is *relevant*, and maintaining a complete, accountable record so that no result the user
produced ever silently disappears.

## Journal Entries

### 2026-06-19 — closed the accountability gap: edmini's voice output now hits the ledger (rv9)

Surfaced while verifying 9ex. The user asked, pointedly, *"Why are you asking me this? can't you read
the text of edmini's output?"* — and the honest answer was no. Ed's spoken replies
(`response.output_audio_transcript.done`) lived only in the browser's turns UI;
[`VoiceAgent.tsx:508`](src/components/VoiceAgent.tsx) updated the bubbles but never logged them. So
the server-side event log and the ledger had the User's words, the tool calls, and the narration
*input* I inject — but not what Ed actually *said*. That's not just an observability gap: the
**edmini → User** crossing is a boundary the §0 "ledger is the system of record, nothing silently
disappears" thesis says should be recorded, and wasn't (the ledger had harness↔edmini but not the
voice crossing).

Fix: `POST /api/voice-output { text, runId? }` → `ledger.append({source:"edmini",
kind:"voice_output", payload:{text}})` (service-role, since the browser only holds the anon key);
`VoiceAgent` fires it on each finalized Ed transcript. Now all three crossing directions are in the
ledger. Verified live: a POST landed `seq 49 edmini voice_output {"text":"That's 400…"}`. 76/76 tests
(3 new), tsc + build clean. Bead `edmini-rv9`. Practical payoff: I can now read exactly what Ed said
from the ledger on every test instead of asking.

Also this session: the 9ex retest itself succeeded — two concurrent labeled runs (`20s`, `15s`)
dispatched and both answered by Hermes **one second apart** (03:17:22 / :23), which finally grounds
that Hermes is **not** strictly single-task — it ran two quick tasks concurrently. (The first attempt
hit `Unknown tool call: delegate_task` — a stale cached client bundle, fixed by a hard refresh.)

---

### 2026-06-19 — a new open problem surfaced: input addressivity ("focused" vs "public")

The user raised a direction worth its own design later, captured now as a rough outline
([`docs/architecture/open-problems.md`](docs/architecture/open-problems.md), bead `edmini-qo3`): in
their words, *"edmini should not answer to ALL audio. it should listen but should only respond if the
user specifically addresses edmini (to avoid the noisy environment issue)."* And the sharp twist:
*"edmond needs to remember input, but may need to decide later if this was actually addressed to it or
not. Perhaps we need a 'focused' <> 'public' mode."*

Two things crystallised:
- **This is the input side of the attention thesis.** v1 "attention accounting" is edmini protecting
  the *User's* attention across runs (output). Addressivity is the inverse — edmini computing the
  relevance of incoming audio *to itself*. A decide-later/retroactive-promotion problem: it must
  buffer ambient speech it didn't act on, because "book that" can refer to context the User set while
  talking to someone else.
- **A naming-collision trap to avoid.** v3 explicitly rejected `ambient`/`focused`/`meeting` "modes"
  ([v3 §6](docs/architecture/supervisor-architecture-design-v3.md)) — but that was about
  *output/surfacing* (foreground vs background app focus). The User's "focused/public" is a different
  axis (*input addressivity*). Same words, different concept; the note flags it so a future design
  keeps them apart.

While there, reconciled doc drift: the v1 design §6 still said "one active run" — updated for 9ex's
concurrent runs. And a small vindication — v3 §1 *already* stated the insight I'd fumbled earlier
("single-stream is a property of the voice channel… input is multiplex, the channel serial"); v1 had
regressed from it. Updated §8/§9 accordingly and pointed them at the open-problems note.

---

### 2026-06-19 — concurrent run narration implemented (9ex): labels + a priority queue

Built the lift from one-active-run to **N concurrent runs**, straight from the approved spec. The
user asked to see the plan in the plan window (`EnterPlanMode` → wrote
`~/.claude/plans/buzzing-napping-puzzle.md` → `ExitPlanMode`, approved unedited), then I worked the
six steps bottom-up.

Two new pure modules (mirroring the `ledger.ts` pure-core / `ledger-supabase.ts` binding split), each
TDD'd:
- `src/lib/voice/run-registry.ts` — the label↔runId map. `register(runId, requested)` returns the
  **canonical** label after a collision suffix (`export` taken → `export-2`); `resolveLabel`,
  `labelFor`, `setStatus`, `remove`, `has`. A cache/projection over the ledger — and because the
  collision rule is deterministic by registration order, replaying persisted `task_dispatch` labels
  through `register()` reconstructs the same canonical labels (so future rehydrate is free).
- `src/lib/voice/narration-queue.ts` — **source-agnostic** by design (the seam for a future run-less
  "invoker" producer). `enqueue` + `drain(canSpeak)` returns all `high` items (run_blocked/failed)
  else all `low` (run_output/done), only when the channel is idle, collapsing simultaneous items into
  one batch.

Wiring:
- `/api/bus` dispatch now persists `label` in the `task_dispatch` payload (one-line change + test).
- `/api/session` tools take `label`: `delegate_task(instruction, label)`, `answer_run(label, text)`,
  `cancel_run(label, reason?)`; instructions rewritten for many concurrent labeled runs and
  label-tagged background updates.
- `src/components/VoiceAgent.tsx`: `activeRunIdRef` → `runRegistryRef` + `narrationQueueRef`.
  `dispatchToolCall` registers on dispatch (hands the canonical label back to the model) and resolves
  label→runId for answer/cancel. `handleLedgerEvent` enqueues by label; a `tryDrain()` fires the
  next batch only when `canSpeak()` = dc open ∧ `!userSpeaking` ∧ `!responseActive`. Two new flags:
  `userSpeakingRef` (speech_started/stopped) and `responseActiveRef` (response.created/done, plus set
  on every `response.create` we send) — the latter is what stops a queued narration from firing
  `response.create` into an in-flight response ("conversation already has an active response").
  Triggers: enqueue, `response.done`, `speech_stopped`.

Verification: `tsc` clean, **73/73 tests** (12 new for the two modules + the bus label test), `next
build` passes. Verified the backend live on the dev server (hot-reloaded): `/api/session` requires
`label` on all three tools; a `/api/bus` dispatch persisted `{"label":"sixes", …}`. `edmini-9ex`
closed + `needs-verification` — the concurrent-narration *behavior* (two labeled runs narrating by
priority without interrupting the user, cancel/answer by label) needs the live voice test.

**Race noted for the live test:** if a harness event lands in the gap after the user stops speaking
but before the model's own response starts, the `speech_stopped` drain could fire `response.create`
just as the model auto-responds; `responseActiveRef`'s optimistic set covers most of it, but the
window is the thing to watch when testing concurrency.

---

### 2026-06-19 — fw5 verified on a real voice loop + deployed to Vercel (the v1 capstone works)

The day's payoff: **the v1 voice loop works end-to-end on a live OpenAI Realtime mic session.** Tested
on `localhost:3000` (app + bus worker + Hermes gateway all local):

- *"Calculate 20 times 20"* → `delegate_task` → `/api/bus` dispatch (ledger seq 17) → Hermes
  "20 × 20 = **400**" → worker interpret `run_output` (seq 19) → Supabase Realtime → browser → **Ed
  spoke "400" back.** The user, asked if Ed narrated the result: **"Yes it spoke back."** That's the
  one hop nothing upstream could prove — the whole inbound narration chain (ledger→Realtime→browser
  inject→speech) lit up.
- *"Calculate 10 times 20"* then *"cancel that"* → `cancel_run` fired (seq 25); **"It said it was
  cancelled."** Note the race: Hermes had *already* answered "200" one second before the cancel landed
  (seq 23 reply vs seq 25 cancel), and replied "Got it — already done." Because `cancel_run` clears
  `activeRunId`, Ed correctly went quiet on the stale "200" — cancel wins.

So `delegate_task` ✅, inbound narration ✅, `cancel_run` ✅ over real voice. `edmini-fw5` → `verified`.

**Deployed to Vercel for phone testing (`edmini-gqg`).** The repo auto-deploys `main`, so the fw5 code
was already live — but prod had only a stale 57-day `OPENAI_API_KEY` and was missing six env vars.
Added `EDMINI_DISCORD_BOT_TOKEN`, `EDMINI_BUS_CHANNEL_ID`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the
`NEXT_PUBLIC_*` are build-time inlined → required a fresh `vercel --prod`), refreshed the OpenAI key.
Verified on prod: `https://edmini.vercel.app` is **public** (the deployment-hash + git-branch aliases
are SSO-gated — easy trap), serves `delegate_task/answer_run/cancel_run`, has the Supabase ref inlined
in the client JS, and a prod `/api/bus` dispatch flowed Discord → Mac worker → ledger `run_done`.

**The architectural seam that phone testing exposes:** the worker can't go to Vercel (serverless can't
hold the Discord gateway). So inbound narration on the phone works only while *some* worker is up —
the Mac one for now. Hence `edmini-4vi`: host the worker on an always-on platform. Leaning Fly (flyctl
already installed, possibly a leftover hackathon app to reuse — pending `fly auth login` to check);
switching Fly↔Railway later is ~30 min since the worker is just `tsx worker/index.ts` + 5 env vars.

**Findings logged along the way:** the inbound interpreter classifies short final answers inconsistently
as `run_output` vs `run_done` (both narrate, so cosmetic); the dispatch still double-logs the instruction
as `discord_message` (transport posts it to the channel *and* re-posts in the thread it spawns — seq
11/12 had different messageIds, one equal to the runId/thread-id — pre-existing `oys` behavior, harmless
but worth a cleanup).

---

### 2026-06-19 — fw5 pt2 shipped, then a design it forced us to undo (voice rewire → concurrent narration)

Two-part day. First, **fw5 pt2** — the v1 voice capstone — landed (`fcaf456`): `/api/session` tools
swapped from `classify_and_route`/`cancel_pending_action` to `delegate_task`/`answer_run`/`cancel_run`;
`VoiceAgent.tsx` `dispatchToolCall` now POSTs `/api/bus` and tracks a single `activeRunId`; the browser
subscribes to the ledger via `ledgerFromEnv().subscribe()` and narrates `run_blocked/output/failed/done`
for the active run into the live Realtime session (`conversation.item.create` user-msg + `response.create`).
tsc clean, 60/60 tests, build passes. Closed + `needs-verification` (live mic test outstanding).

Then the review turned into the real work of the day — two corrections from the user, both load-bearing.

**1. "Hermes is single-task" was an overstatement I'd inherited, not verified.** Asked to justify it, I
traced it to one observation during `pmo` fixture capture: a `❓ clarify:` *holds the Hermes session*, so
rapid follow-ups came back `⏳ Still working…`. The journal archive even calls it "a second, accidental
finding." The defensible claim is narrower — *a blocked run holds the session* (observed) — not *Hermes
can only ever run one task* (untested inference). The "~6–60s replies" I'd quoted was also a guess; the
only timing fact is the ~3-min `⏳` heartbeat. Lesson logged: don't carry forward an inherited inference as
fact across sessions.

**2. The whole "one active run" rationale was a conflation.** I'd justified the single-run cap as following
from "voice is serial → attention accounting" (design doc §1/§2). The user:

> "voice is serial" means that the conversation between edmini and the user is technically single
> threaded ALTHOUGH more than one topics/tasks/thread may be referenced in a single sentence or
> paragraph. That said, there is no such limitation between edmini and the executor(s)

That untangles three things I'd run together: **input** (one utterance can *reference* many runs),
**output** (edmini speaks one thing at a time — the *only* real serial constraint), and **edmini↔executor**
(bus/API calls, fully concurrent — no seriality at all). Seriality constrains output **multiplexing**, not
run **cardinality**. What voice *actually* forces is a *narration-scheduling* problem — when many runs
contend for one output channel, what do you say and when? One-active-run didn't honor the medium; it
**dodged that scheduler** by making it trivial. A scope cut dressed as a property of voice. And the cap
lived entirely in the voice client — the backend (ledger keyed by `runId`, a Discord thread per task, the
worker) was concurrent all along. Our fw5 implementation was even stricter than the doc: §6 says non-active
runs sit "unread," but `handleLedgerEvent` *silently ignores* them.

**Decision (user picked "Full concurrent narration"):** supervise N runs; narrate all by priority.
Brainstormed the two forks that actually shape the code:
- **Addressing → human-friendly labels.** The model assigns a short label per task (`"export"`,
  `"research"`) and reuses it; `delegate_task/answer_run/cancel_run` take `label`; raw `runId` snowflakes
  stay internal and are never spoken. Client de-dups label collisions and returns the canonical one.
- **Narration → priority + never interrupt the user.** `run_blocked/run_failed` high, `run_output/run_done`
  low; a client-side queue drains one batch at a time only when idle (channel open ∧ user not speaking ∧ no
  response in flight), batching near-simultaneous items ("Two things — the export failed, and research is
  asking about Q3").

Two foresight notes from the user folded in at near-zero cost:
- *"persist the registry in a db ... in the future redis(?)"* — made nearly free by writing the `label` into
  the existing `task_dispatch` ledger payload. The registry becomes a **cache/projection** over the ledger
  (same as the SQL `runs` view over `events`); rehydrate-on-reload becomes a query, not new storage. Persist
  the write now, defer the read.
- *"the 'invoker' role ... an agent or app or api or webhook that can send events to edmini, e.g. email,
  IOT"* — an invoker event is inbound but **run-less** (no label, no registry entry). Keep
  `narration-queue` **source-agnostic** so it slots in later as a second producer. Don't widen the ledger
  `source` enum (`user|edmini|harness`) yet — additive migration when actually built.

Spec written + approved: `docs/superpowers/specs/2026-06-19-concurrent-run-narration-design.md`
(`edmini-9ex`, under epic `edmini-orm`). New pure modules `src/lib/voice/run-registry.ts` +
`narration-queue.ts` (mirroring the `ledger.ts`/`ledger-supabase.ts` pure-core/binding split), then
rewire `VoiceAgent.tsx` and add `label` to `/api/bus` dispatch + `/api/session` tools. Implementation
plan next.

**Angles worth publishing.** *The justification that wasn't* — shipping a feature, then having the user
prove its stated rationale was a category error ("serial channel" ≠ "one task"). *Where a constraint
actually lives* — the single-run limit was 100% client-side over an already-concurrent backend; the
medium was blamed for a scope cut. *The ledger pays for foresight* — "persist it" and "leave room for
invokers" both cost ~nothing because there's already one append-only source of truth.

---

### 2026-06-19 — Run correlation fixed + outbound bus API (oys, fw5 pt1)

- **oys (run correlation):** `discord-transport.dispatch()` now creates a Discord PUBLIC_THREAD per
  task and posts the instruction into it; `runId` = thread id. Experiment confirmed Hermes replies
  *inside* an edmini-created thread (`9 × 9 = 81` in-thread, 6s). E2E smoke: dispatch +
  `harness/discord_message` + interpreted `harness/run_output` all under one `runId`. Commit `4143dfd`.
- **fw5 pt1 — outbound API:** `src/app/api/bus/route.ts` — `POST /api/bus {action: dispatch|answer|
  cancel}` → Discord transport + ledger log (returns `runId` on dispatch). 4 route tests (mocked
  transport+ledger). Commit `ab5f3c4`.
- Verification: tsc clean, 60 unit tests, `next build` passes.

**Next (fw5 pt2 — the v1 capstone):** rewire `VoiceAgent.tsx` Realtime tools → `/api/bus` + track
`activeRunId`; inbound "Narrate" via Supabase Realtime (browser) injecting active-run ledger events
into the live session; then a manual voice test.

---

### 2026-06-19 — Bus build: ledger client, transport, interpreter, worker (yak/n12/dze/2y7)

Built and live-verified the v1 data path (voice app/worker ⇄ Discord bus ⇄ Hermes, Supabase ledger
as system of record). Inbound half complete.

**What changed**
- `src/lib/ledger-supabase.ts` (yak): `createLedger(client)` + `ledgerFromEnv()` — append/snapshot/
  subscribe over the pure core in `src/lib/ledger.ts`. Commit `a935e2d`.
- `src/lib/bus/transport.ts` + `discord-transport.ts` (n12): `BusTransport` (dispatch/answer/cancel)
  + Discord REST outbound as the edmini bot. Commit `c68d25d`.
- `src/lib/bus/interpret.ts` (dze): marker-deterministic + LLM-fallback classifier. Commit `2367a24`.
- `worker/index.ts` (2y7): always-on discord.js gateway → interpret → ledger. `pnpm worker`. `42c5547`.
- deps: `@supabase/supabase-js` 2.108.2, `discord.js` 14.26.4; pnpm pinned 9.15.9 via corepack (4sw).

**Decisions**
- Interpreter is marker-first (Hermes emoji taxonomy), LLM only for plain text. Heartbeats (⏳) → `ignore`.
- The worker is the single ledger tap (logs ALL crossings incl. edmini's own); the transport only
  posts. Matches §0 (every happening → a ledger event).
- `serviceRole` key server-side (worker/API), anon for browser subscribe.

**Diagram + interpreter markers**
```mermaid
flowchart LR
  VA[Voice app] -- "dispatch/answer/cancel (REST)" --> D{{#edmini-bus}}
  H[Hermes] <-- messages --> D
  W[Bus worker: gateway + interpret] -- reads --> D
  W -- append events --> L[(Supabase ledger)]
  L -. Realtime .-> VA
```
`❓`→run_blocked · `⏳`→ignore · `⚠️`/shutdown→run_failed · `online —`→run_started · plain→LLM (default run_output).

**Verification**
- tsc clean; 56 unit tests (envelope, ledger, ledger-supabase, transport, interpret).
- Live: ledger append/snapshot/projectRuns vs real DB; transport dispatch → real Discord message;
  worker E2E → dispatched "what is 6×7?", Hermes replied "42", worker interpreted `run_output`,
  ledger rows confirmed (`harness/discord_message` + `harness/run_output`).

**Gotchas**
- Discord requires a `DiscordBot (...)` User-Agent or Cloudflare returns 403/1010.
- pnpm 8-on-PATH vs lockfile-9/store-10 → corepack `pnpm@9` (`packageManager` pinned).
- `SUPABASE_DB_URL` lives in `infra/supabase/project.env` (not `.env.local`) — empty var made psql hit local PG.
- Run-correlation: Hermes replies under its own message id, not threaded from the dispatch, so a reply
  isn't linked to its task (dispatch `…023…` vs reply `…057…`). Filed `edmini-oys`.

**Open / next**
- `edmini-oys`: run-correlation (likely edmini-creates-thread, or single-active-run + time).
- `edmini-fw5`: voice rewire (lean 3-phase, one active run) — consumes the ledger feed.

> _Earlier narrative-style entries (2026-06-17 → 2026-06-19 "the bus that wouldn't talk") were
> archived verbatim to [`docs/journal-archive.md`](docs/journal-archive.md) on 2026-06-19, when the
> journal switched to the pragmatic style._

