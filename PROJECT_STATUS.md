# edmini — Project Status

## Branch / VCS
`main` (git), in sync with origin. Latest infra commit `8181556`. Beads synced to the Dolt remote
(`bd dolt push --remote origin`; `refs/dolt/data` on GitHub).

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

## NEXT SESSION — start here: `edmini-fw5` part 2 (voice rewire, the v1 capstone)
The whole backend (bus + ledger + worker + interpreter + outbound API) is built & live-verified.
Only the VoiceAgent client rewire remains. Three steps, then v1 is done:
1. **Realtime tools** — in `src/app/api/session/route.ts` replace `classify_and_route` /
   `cancel_pending_action` with `delegate_task(instruction)` / `answer_run(text)` / `cancel_run()`;
   in `src/components/VoiceAgent.tsx` make `dispatchToolCall` POST to `/api/bus` and track
   `activeRunId` (one active run; `delegate_task` sets it from the returned `runId`).
2. **Narrate (inbound)** — in `VoiceAgent.tsx` subscribe the browser to Supabase Realtime
   (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, both in `.env.local`) using
   `createLedger().subscribe()`; on events for `activeRunId` with kind `run_blocked` / `run_output`
   / `run_failed`, inject into the live session via `conversation.item.create` + `response.create`
   (reuse the `sendToolResult` data-channel pattern) so edmini speaks them.
3. **Manual voice test** — run `pnpm dev` (app) + `pnpm worker` (bus worker) + `hermes gateway` (or
   it's the launchd service). Speak → edmini `delegate_task` → Discord thread → Hermes replies →
   worker → ledger → Realtime → edmini speaks it. (Hermes is single-task; expect ~6–60s replies.)

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
