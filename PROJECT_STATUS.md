# edmini — Project Status

## Branch / VCS
`main` (git), in sync with origin. fw5 pt2 rewire landed `fcaf456`. Beads synced to the Dolt remote
(`bd dolt push --remote origin`; `refs/dolt/data` on GitHub).

## ACTIVE (2026-06-19): concurrent run narration (`edmini-9ex`) — spec approved, planning next
fw5 pt2 shipped a **one-active-run** voice layer (single `activeRunId`, other runs' events ignored).
In review the user dismantled the justification: "voice is serial" constrains only the edmini↔user
**output channel**, not run **cardinality** — and there is no seriality at all on edmini↔executor.
Decision: lift the cap. The voice layer will supervise **N concurrent runs**, addressed by
**model-chosen human-friendly labels** (`delegate_task/answer_run/cancel_run` take a `label`), with a
**priority narration queue** (run_blocked/run_failed high, run_output/run_done low) that never
interrupts the user and batches near-simultaneous items. Labels are **persisted in the
`task_dispatch` ledger payload** (registry = cache/projection; rehydrate-on-reload deferred but data
exists). Narration queue kept **source-agnostic** to leave room for a future **invoker** inbound role
(email/IoT/webhook → run-less events) without rework. Spec:
`docs/superpowers/specs/2026-06-19-concurrent-run-narration-design.md`. NEXT: writing-plans →
implement (new `src/lib/voice/run-registry.ts` + `narration-queue.ts`, rewire `VoiceAgent.tsx`,
add `label` to `/api/bus` dispatch + `/api/session` tools). `fw5` stays closed/`needs-verification`;
9ex supersedes its single-run behavior.

## Where we are (2026-06-18)
Building **v1: a voice supervisor over an agent harness** (epic `edmini-orm`). Design + plan are
done; tonight was foundations + reproducible infra + live provisioning.

### Done this session
- **Foundations (code, tested):** `src/lib/bus/envelope.ts` (normalized envelope contract),
  `src/lib/ledger.ts` (ledger types + `projectRuns` projection) + 11 unit tests. `tsc` clean,
  37/37 tests, `next build` passes.
- **Cleanup (`edmini-4ep` ✓):** deleted the hackathon executor (`execute.ts`, Tavily/Telegram, the
  capability switch); `processAction` now delegates; removed obsolete tests + `supervisor:test`;
  untracked `tsconfig.tsbuildinfo`.
- **Reproducible infra (`infra/`):** `init.sh`/`up.sh`/`preflight.sh` + Discord `bootstrap.sh` +
  Supabase `provision.sh`/`apply.sh` + Hermes `configure.sh`/`reset.sh`/`status.sh`/`send-test.sh`,
  grounded in the real Hermes v0.14.0 CLI. Secrets via **1Password `op://` refs** resolved at runtime.
- **Discord bus — LIVE & verified:** both bots (`EdHermes`, `Edmini`) in a dedicated server (guild
  `1517061705967079475`), `#edmini-bus` created (`1517068895578620026`), Hermes configured (real
  token in `~/.hermes/.env`, gateway restarted), `hermes send` lands in the channel.

### Infra COMPLETE (`edmini-335` ✓, 2026-06-19)
- **Supabase ledger LIVE:** project `edmini-ledger` (ref `ljrefeouubyunxjcujma`) created + healthy;
  `0001_ledger.sql` applied (events table + runs view + no-mutate trigger + realtime publication,
  all verified); psql connects via the real pooler URL (`aws-1-us-east-1.pooler.supabase.com:6543`,
  in `project.env`). Lesson: the Supabase outage cleared after a few hours; apply now goes through
  the **Management API SQL endpoint** (`provision.sh`/`apply.sh` fixed — fetch real pooler host, no
  more constructed `aws-0` guess).
- Both halves (Discord bus + Supabase ledger) are up. `preflight.sh` needs the 1Password vault
  unlocked when run (it re-locks between calls).

### Harness + bus VERIFIED (`edmini-pmo` ✓, `edmini-4sw` ✓, 2026-06-19)
- **Bus is bidirectional** — Hermes reads `#edmini-bus` and replies, verified for BOTH human→Hermes
  and the production **edmini-bot→Hermes** path (`infra/hermes/capture-fixtures.py`).
- **3 Hermes gates** found (via source + `gateway.log`) and fixed into `configure.sh`:
  (1) `config.yaml` `free_response_channels:''`/`require_mention:true` override env (config wins for
  routing); (2) `DISCORD_ALLOW_BOTS` must be `all` (not `true`); (3) user auth is ENV-gated
  (`DISCORD_ALLOW_ALL_USERS`), not config.yaml.
- **`4sw`** — pnpm pinned to 9.15.9 via corepack (`packageManager`); `@supabase/supabase-js` 2.108.2 in.
- **Interpreter insight (for `dze`)** — Hermes uses emoji markers: `❓ clarify:`=run_blocked,
  `⏳ Still working…`=heartbeat (~180s), `⚠️`=run_failed, plain=run_output. Fixtures:
  `src/lib/bus/__fixtures__/hermes-messages.json`. Hermes is single-task (validates one-active-run).

### Inbound + outbound bus DONE (2026-06-19)
- `edmini-yak` ✓ ledger client (`src/lib/ledger-supabase.ts`), `edmini-n12` ✓ transport
  (`src/lib/bus/transport.ts` + `discord-transport.ts`), `edmini-dze` ✓ interpreter
  (`src/lib/bus/interpret.ts`), `edmini-2y7` ✓ worker (`worker/index.ts`, `pnpm worker`). All
  live-verified (see journal). 56 unit tests, tsc clean. Deps: `@supabase/supabase-js`, `discord.js`;
  pnpm pinned 9.15.9 via corepack (use `corepack pnpm`).

### oys + fw5 part 1 DONE (2026-06-19)
- `edmini-oys` ✓ run-correlation: `dispatch()` creates a Discord thread per task → `runId` = thread
  id; Hermes replies in-thread; verified dispatch + reply + interpreted event share one `runId`.
- `edmini-fw5` part 1 ✓ outbound API: `src/app/api/bus/route.ts` (`POST /api/bus` dispatch/answer/
  cancel → transport + ledger). 60 tests, tsc clean, build passes.

### fw5 part 2 — voice rewire DONE, code-complete (2026-06-19, commit `fcaf456`)
`edmini-fw5` ✓ closed + `needs-verification`. The v1 voice capstone is wired end-to-end in code;
all three planned steps are landed except the live mic test (the verification gate):
1. **Realtime tools ✓** — `src/app/api/session/route.ts`: `classify_and_route`/`cancel_pending_action`
   replaced with `delegate_task(instruction)` / `answer_run(text)` / `cancel_run(reason?)`; instructions
   describe the one-active-run delegate→harness model + background narration. `VoiceAgent.tsx`:
   `dispatchToolCall` POSTs `/api/bus`; `activeRunIdRef` set on dispatch, used by answer/cancel.
2. **Narrate (inbound) ✓** — `VoiceAgent.tsx` subscribes the browser via `ledgerFromEnv().subscribe()`
   on session start (anon key from `NEXT_PUBLIC_SUPABASE_*`; RLS is OFF on `events` so anon Realtime
   delivery works). `handleLedgerEvent` filters to `source==="harness"` + `runId===activeRunId`,
   narrates `run_blocked/run_output/run_failed/run_done` via `injectNarration` (user-role
   `conversation.item.create` + `response.create`). `run_done`/`run_failed` clear `activeRunId`.
3. **Manual voice test — PENDING (only remaining item for v1).** Run `pnpm dev` + `pnpm worker` +
   `hermes gateway` (launchd). Speak → `delegate_task` → Discord thread → Hermes → worker → ledger →
   Realtime → Ed speaks it. Hermes is single-task; expect ~6–60s replies. After verifying on device,
   remove the `needs-verification` label from `edmini-fw5` (`bd label remove edmini-fw5 needs-verification`)
   and add `verified`.

To run the bus worker: `pnpm worker`. To re-provision infra if needed: `./infra/up.sh` (1Password
must be unlocked). Ledger queries: `SUPABASE_DB_URL` is in `infra/supabase/project.env` (not .env.local).

## Gotchas / decisions
- **Discord bots cannot create servers** (`code 20001`). You create/pick one; bootstrap auto-detects
  the server both bots share and creates the channel. Admin perms on a dedicated server for simplicity.
- **1Password:** `project.env` stores `op://` refs only; scripts resolve via `op read` (desktop
  integration → biometric per call). `op whoami` is unreliable under integration — don't gate on it.
- **pnpm drift** (`edmini-4sw`): lockfile is 9.0 but PATH pnpm is 8.15.9 → `pnpm add/install` fails.
  Resolve before adding `@supabase/supabase-js`.
- **Supabase free tier = 2 projects/org**; `edgar` was deleted to make room for `edmini-ledger`.
- Supabase session-pooler URL is constructed, not fetched — preflight verifies; dashboard URI is the
  fallback if it can't connect.

## Tests / Build
- `npx tsc --noEmit` clean · `pnpm test` 37/37 · `pnpm build` passes.

## Journaling
- Narrative source: `PROJECT_JOURNAL.md` (publication style; auto-captured on compaction by
  `.claude/hooks/journal-precompact.sh`, nudged on Stop). `docs/SESSION_SUMMARIES.md` auto file logs.
