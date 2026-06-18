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

### Blocked / pending
- **Supabase ledger** (`edmini-yak`, `edmini-335`): project creation is disabled platform-wide
  (Supabase incident). API still returns "Project creation is currently disabled" even after the
  dashboard banner cleared. **Resume:** re-run `./infra/up.sh` once creation is restored (or create
  `edmini-ledger` in the dashboard and paste the Session-pooler URI into
  `infra/supabase/project.env` → `SUPABASE_DB_URL`, then `./infra/supabase/apply.sh`). Idempotent;
  DB password already persisted in `project.env`.

## Next steps (in order)
1. **Finish provisioning** (`edmini-335`): create the Supabase project (outage permitting) →
   `./infra/up.sh` → `./infra/preflight.sh`. Confirm **Message Content Intent ON for both bots**
   (preflight can't check it).
2. **Harness standup** (`edmini-pmo`): confirm Hermes *reads* `#edmini-bus` after channel discovery;
   capture ~10 real free-form message fixtures for the interpreter.
3. **Build chain:** `edmini-yak` (Supabase client binding — needs the pnpm drift `edmini-4sw`
   resolved to add `@supabase/supabase-js`) → `n12` (Discord transport) → `2y7` (bus worker) →
   `dze` (LLM interpreter) → `fw5` (voice rewire).

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
