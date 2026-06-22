# edmini — Project Status

## Branch / VCS
`main` (git), in sync with origin. Latest `aee4d49`. Beads synced to the Dolt remote
(`bd dolt push`; `refs/dolt/data` on GitHub).

## CHECKPOINT (2026-06-22b) — enrollment UX polish; starting the multi-speaker roster (q1e)
On-device use of the speaker-ID feature drove a run of polish, then a roster decision.

- **`d6z` pause-edmini-during-enrollment — CLOSED + needs-verification.** Reciting the passage was
  reaching OpenAI (shared raw mic track) → Ed answered. Fix: `replaceTrack(null)` mutes the mic to OpenAI
  during the enroll modal (TS-VAD tap is a separate AudioContext, unaffected) + `enrollingRef` pauses
  narration. (`ff6f331`)
- **`hy8` grade chip — DONE (bead still open for the toggle-drop half).** Per-message speaker-ID confidence
  now shows next to the timestamp on answered turns (colored dot + number, enrolled-only). Remaining hy8:
  drop the on/off toggle (grading ON whenever enrolled). (`aee4d49`)
- **`1wm` name at enrollment — CLOSED + needs-verification.** Skippable "What should Ed call you?" text step;
  stored on the Enrollment, sent to `/api/session` → Ed addresses you by name. Typed, not voiced. (`aee4d49`)
- **`q1e` multi-speaker roster — IN PROGRESS (next).** Reframed: manual enrollment is the entry point (the
  voice-triggered `6kl` is a later 2nd entry, dep removed). **DECISION: identify-only** — Ed still acts only
  on the principal; other enrolled voices are attributed by name, non-enrolled = unknown/suppressed. Design:
  roster store (N named + principal; migrate the single enrollment) → pipeline scores each window vs ALL
  centroids (embed once, N≈free) → reuse `speaker-classifier.ts` at turn-end, respond iff classified==
  principal. Back-compat invariant: principal-only == today's behavior. Building **thin slice first** (roster
  + add-another-voice + name-on-turn display, gate untouched), iee-way (plan → subagent-driven + eval).

## CHECKPOINT (2026-06-22) — iee verified; speaker-ID model hosted on Vercel Blob
Live-tested `iee` on device; it surfaced a 3-layer `search_history` bug (all fixed), then **`iee` was
verified + closed**. Hosted the speaker-ID model (`5on`), and added model provenance tracking.

- **`iee` session memory — CLOSED + verified.** Live testing flushed out a cascade in the `search_history`
  backend, each masking the next: (1) `jsonb` has no `ILIKE` (42883) → query `payload->>keys` ILIKE OR'd;
  (2) `snapshot` returned **oldest-N** not most-recent (also silently truncated `/api/session` Recent
  history past 200 events) → return most-recent-N; (3) whole-phrase substring missed the **compound word**
  ("code name" ≠ stored "codename") → tokenize the query + OR terms. A `[history]` param/count diag log
  (kept in prod) pinned layers 2–3. The `nvb` eval mock was tightened to mirror real PostgREST (its loose
  match had let these pass green). Lesson recorded: verify the real input, not a query that happens to work.
- **`5on` host TS-VAD model — CLOSED + needs-verification.** CAM++ `zh_en` (the `ce9` winner, ~28 MB,
  gitignored) is now on **Vercel Blob** (store `edmini-tsvad`, public + CORS-open). New `TSVAD_MODEL_URL`
  seam = `NEXT_PUBLIC_TSVAD_MODEL_URL ?? "/models/campplus.onnx"` (prod → Blob, local dev → file). Deployed
  `8e694d5`. **On-device verify:** grading panel shows "Speaker grading active" (not "unavailable"/fail-open).
- **`nvb` eval harness — CLOSED + verified.** `pnpm test:iee`: deterministic CI eval of the iee logic
  (utterance→session seam, search_history recall, rehydration, catch-up) — no OpenAI/browser. 182 tests.
- **`13y` model provenance — CLOSED + verified.** `model-manifest.json` (sha256 + source + Blob URL + ce9
  provenance) + `pnpm models:check` (HEADs HF `x-linked-etag`=sha256 vs recorded; Range-GETs Blob for size;
  exit 1 on drift). Cron/CI-ready.
- **`ce9` accuracy — CLOSED + needs-verification.** WINNER CAM++ zh_en (margin 0.538 vs 0.224). Re-tune the
  grader/classifier threshold on the hosted model on device.
- **`put` (P2, NEW open)** — non-speech audio (a macOS volume **beep**) → whisper hallucinated "Bye-bye" → a
  phantom user turn Ed answered. Grade-and-suppress (on + enrolled) already suppresses this; whisper
  no-speech gating is the belt-and-suspenders. Not an iee bug.

**NEXT (user, on device):** confirm `5on` (enable grading → "Speaker grading active"); re-tune `ce9`
threshold. Backlog next-up: `hy8` (grading-on-by-default once enrolled — also mitigates `put`), `put`,
`nvb`-follow-on `7fn` (voice/audio E2E). Periodic model check: wire `pnpm models:check` into CI/cron.

## CHECKPOINT (2026-06-21) — session memory + speaker-ID accuracy shipped (both needs-verification)
Two independent streams developed in parallel worktrees, both merged `--no-ff` to main and pushed (`1bb2fc8`,
triggers prod deploy). 172 tests / tsc / build green on merged main.

- **`iee` session memory — CLOSED+needs-verification.** Reads the ledger back on session start: registry
  rehydration (fixes cross-session event drop), catch-up-on-resume (audio-off misses), dumb Recent-history
  block + `search_history` tool + `/api/history` & `/api/conversation/utterance` routes, `prevRunId`
  provenance, User-utterance logging. 8 tasks, subagent-driven + per-task review + opus whole-branch review.
- **`ce9` accuracy bake-off — CLOSED+needs-verification.** WINNER **CAM++ zh_en**: separation margin
  **0.538 vs 0.224** baseline (diff-cos 0.634→0.294), same 54ms. ERES2Net (zh-cn) worse+slower — bilingual
  *data*, not architecture, is the English lever. New pure `speaker-classifier.ts` (top1−top2 gate,
  single-centroid back-compat, 9 tests). Unblocks `5on` (host `campplus_zh_en.onnx` on Vercel Blob).

**NEXT (user, on device):** live checks (a)/(b)/(c) for `iee`; verify the jsonb `text`/`author`
`search_history` filters live (`payload::text` cast); re-tune `ce9` thresholds for the wider zh_en margin.
Then `5on` (host the chosen model). See `.remember/remember.md` for the full handoff.

## CHECKPOINT (2026-06-20) — v1 voice loop working; live-testing & hardening
v1 is functionally complete and live at **https://edmini.vercel.app** (prod). Bus worker runs on **Fly**
(`edmini-bus-worker`, sole tap; Mac worker retired). Recent live-testing surfaced and fixed several real
issues; the architecture also gained two "don't overfit to one vendor" principles.

**Done + landed (mostly `needs-verification`, pending on-device re-test):**
- `9ex` concurrent run narration (labels + priority queue) — VERIFIED. `rv9` voice_output→ledger — VERIFIED.
- `mb0` narration progress (conservative wall-clock spoken cursor, dim-the-unspoken). `iwi` UI timestamps.
- `mgi` **run lifecycle**: don't evict a run on `run_done` (harness streams many msgs; eviction was
  dropping the real completion+question → silence). `me3` **confirm/clarify before delegating** (prompt).
- `5ze` faithfulness prompt (don't claim done early). `73d` interpreter: tool-use-progress (`💻`/`✍️`/`📚`)
  → ignore + Hermes markers isolated in a swappable `HERMES_MARKERS` adapter table.
- Infra: service worker REMOVED (`4mf`, root cause of all stale-bundle/ChunkLoadError incidents);
  build-id in header (`0t0`); git-push-only deploys (no hash flapping); `4vi` Fly worker cutover.

**Architecture principles (documented):** voice provider swappable (§6.2, `xct`); harness adapter
swappable / don't overfit Hermes (§4.2). A run is a *stream*, not a tool-call (open-problems: Vercel
Workflows deferred — ledger+worker already durable).

**v1 epic `orm` CLOSED (2026-06-20)** — voice layer over agent harness complete & live-verified.

**Open / backlog (post-v1):**
- `iee` **(P1, next)** — session has NO memory: rehydrate run registry + feed recent conversation/run
  history into the system prompt from the ledger on session start. Fixes both: Ed has zero context of
  past turns/runs, AND a response for a run not in *this* session's registry is dropped (never queued).
  Registry is per-session today; labels are already persisted in the `task_dispatch` payload (mb0), so
  rehydration is a ledger query. The system prompt only gets `getSystemPromptContext` (thread-store),
  not ledger/Discord history.
- `78z` — mb0 highlight still doesn't follow speech (post wall-clock fix); needs live instrumentation.
- `zo8` — rudimentary open-threads/topics UI panel (active runs), separate from the event log.
- `69p` — partial-delivery recovery (queue the remainder, don't barge). `qo3` — input addressivity.
- `xct` — full voice-provider abstraction. (`73d`, `a0g`, `5ze`, `mgi`, `me3`, `iwi` closed this session.)

## ✅ v1 VOICE CAPSTONE VERIFIED end-to-end (2026-06-20)
`edmini-9ex` + `edmini-rv9` → `verified`. Live prod test: two concurrent runs ('20s' 20×20, '30s'
15+17) → Ed narrated BOTH **by label**, in order, no silence/overlap; full conversation (incl. Ed's
`voice_output`) durable in the ledger. Concurrent narration + response.create serialization confirmed.
Also resolved this session: **service worker REMOVED entirely** (`edmini-4mf`) — it was the root cause
of all "stale bundle" incidents (cached HTML → ChunkLoadError, survived close-reopen); replaced with a
self-unregistering kill-switch + `SwCleanup`. Build-id in header (`edmini-0t0`) + git-push-only deploys
(no hash flapping) + inline ChunkLoadError guard. Prod live + public at https://edmini.vercel.app.
REMAINING for v1: persistent worker host (`edmini-4vi`, Fly app `edmini-bus-worker` created + secrets
staged, parked — needs `fly deploy` + Mac-worker cutover). Backlog: `edmini-69p` (partial-delivery),
`edmini-qo3` (input addressivity).

## 9ex concurrent run narration — IMPLEMENTED, code-complete (2026-06-19)
`edmini-9ex` closed + `needs-verification`. Lifted the one-active-run cap → **N concurrent runs**.
New pure modules `src/lib/voice/run-registry.ts` (label↔runId, collision-suffix) +
`narration-queue.ts` (source-agnostic priority queue). `/api/bus` dispatch persists `label`;
`/api/session` tools take `label` (delegate_task/answer_run/cancel_run); `VoiceAgent.tsx` rewired
(registry + queue + `userSpeakingRef`/`responseActiveRef` idle-gating; `tryDrain` on enqueue/
response.done/speech_stopped). tsc clean, 73/73 tests, build passes; backend verified live on dev
(`/api/session` requires label, dispatch persists `{"label":"sixes",…}`). PENDING: **live voice test**
of concurrent narration (two labeled runs, priority, cancel/answer by label) — locally first, then
redeploy prod (`vercel --prod`) to phone-test on edmini.vercel.app. Race to watch: speech_stopped
drain vs model auto-response (see journal). Plan: `~/.claude/plans/buzzing-napping-puzzle.md`.

## 🎉 v1 voice loop VERIFIED end-to-end (2026-06-19)
`edmini-fw5` → **`verified`**. Live localhost mic test: "Calculate 20×20" → Ed spoke "400" (full
inbound narration ledger→Realtime→browser→speech); "cancel that" → `cancel_run` + Ed confirmed
cancellation. delegate_task ✅ narration ✅ cancel_run ✅ over a real OpenAI Realtime session.

Deployed to Vercel for phone testing (`edmini-gqg` ✓, `needs-verification` until phone-tested):
**https://edmini.vercel.app** (PUBLIC; hash/git-branch aliases are SSO-gated — use the prod alias).
Added 6 missing env vars + refreshed stale OPENAI_API_KEY; `NEXT_PUBLIC_*` inlined via `vercel --prod`.

OPEN THREADS:
1. **`edmini-4vi`** — host the bus worker on an always-on platform (worker can't go on Vercel
   serverless). Leaning Fly (flyctl installed, maybe a reusable hackathon app). BLOCKED on user
   `fly auth login` so I can check `fly apps list`. Until then, phone inbound needs the Mac worker up.
2. **`edmini-9ex`** — concurrent run narration spec written + approved; awaiting user spec review
   before writing-plans. (See ACTIVE section below.)
3. Local processes running this session: `pnpm dev` (pid 39254) + `pnpm worker` (pid 39534) +
   Hermes gateway (pid 7770, launchd). Worker log: the btj0qxgca task output.

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
