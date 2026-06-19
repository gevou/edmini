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

## Next steps (in order)
1. **Harness standup** (`edmini-pmo`): confirm Hermes *reads* `#edmini-bus` after channel discovery;
   capture ~10 real free-form message fixtures for the interpreter. Confirm **Message Content Intent
   ON for both bots** (preflight can't check it).
2. **Resolve pnpm drift** (`edmini-4sw`) → add `@supabase/supabase-js`.
3. **Build chain:** `edmini-yak` (Supabase client binding — DB + schema already live) → `n12`
   (Discord transport) → `2y7` (bus worker) → `dze` (LLM interpreter) → `fw5` (voice rewire).

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
