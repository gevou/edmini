# edmini — Project Status

## Branch
`main` (clean, in sync with origin)

## VCS
git

## Deployed
Production: Vercel auto-deploys on push to `main`. Most recent prod deployment is for commit `aea26d0` (merge of PR #3).

## Recent Changes — 2026-05-25 session

### Realtime API Beta → GA migration (PR #3, merged as `aea26d0`)
Audio failed to start with *"The Realtime Beta API is no longer supported. Please /v1/realtime for the GA API."* (Beta shut down 2026-05-12). Two files migrated:

- `src/app/api/session/route.ts`
  - Endpoint: `POST /v1/realtime/sessions` → `POST /v1/realtime/client_secrets`
  - Body wrapped in `{ expires_after, session: { type: "realtime", ... } }`
  - Model: `gpt-4o-realtime-preview-2024-12-17` → `gpt-realtime`
  - `voice` → `session.audio.output.voice`
  - `turn_detection` → `session.audio.input.turn_detection`
  - `input_audio_transcription` → `session.audio.input.transcription`
  - `modalities: ["audio","text"]` → `output_modalities: ["audio"]`
  - `audio.{input,output}.format` is an **object** `{ type: "audio/pcm", rate: 24000 }`, not the string `"pcm16"` (caught at runtime, fixed in `52f15b8`)

- `src/components/VoiceAgent.tsx`
  - SDP exchange: `POST /v1/realtime?model=...` → `POST /v1/realtime/calls` (model derived from session)
  - Event renames in `handleDataChannelMessage`:
    - `response.audio.delta` → `response.output_audio.delta`
    - `response.audio_transcript.{delta,done}` → `response.output_audio_transcript.{delta,done}`
    - `response.text.{delta,done}` → `response.output_text.{delta,done}`
  - Ephemeral-key reader also accepts top-level `value` on the new response shape.

**Not verified at runtime (assumed unchanged in GA):**
- `input_audio_buffer.speech_started` / `input_audio_buffer.speech_stopped`
- `conversation.item.input_audio_transcription.completed`
- `response.function_call_arguments.done`
- `response.done`

If audio misbehaves around speech start/stop, transcription completion, or function-call arg handling, those are the first events to verify against the GA spec.

### Tooling: bd v1.0.4 reinstated
- Stale `bd v0.49.4` at `~/.local/bin/bd` was shadowing the Homebrew v1.0.4 install. Renamed to `bd.old-0.49.4`. Homebrew `bd` is now active on PATH.
- `.beads/embeddeddolt/` reinitialized with `--prefix edmini` so v1.0.4 (dolt backend) works. The old SQLite DB (`.beads/beads.db`) still exists on disk and contains a closed `edmini-d8h` from before this session — recoverable if needed.
- `bd init` also produced uncommitted/untracked tooling files (see "Loose ends" below).

## Active Beads Issues
- `edmini-7bk` — **closed, label: `verified`** (Realtime API GA migration, verified in production)

## Architecture Notes
- Realtime API: ephemeral key minted server-side via `/api/session` → `POST /v1/realtime/client_secrets`. Client opens an RTCPeerConnection, exchanges SDP with `/v1/realtime/calls` using the ephemeral key, and listens for events on the `oai-events` data channel.
- Thread store: in-memory + `/tmp/ed-threads.json` (file may not persist in serverless).
- Conversation log: in-memory only (no file persistence — resets on cold start).
- Serverless note: both stores reset on cold start; the dashboard's `mergeThreads` logic preserves client-side state across cold starts for threads. Conversation has no equivalent merge.

## Loose Ends (uncommitted at session end)
Not part of any PR yet; user to decide:
- `.gitignore` (modified) and `AGENTS.md` (appended) — bd-init tooling additions
- `CLAUDE.md` and `.claude/settings.json` — new files from bd-init's Claude Code integration
- `tsconfig.tsbuildinfo` (modified) — build artifact, should probably be gitignored
- `.understand-anything/` (untracked) — output from the understand-anything plugin
- `mission-control.html` (untracked) — opened in IDE, unrelated to this session
- The old SQLite beads DB at `.beads/beads.db` containing closed `edmini-d8h` — preserved but unused by v1.0.4

## Tests / Build
- `npm run build` — passes
- `npx tsc --noEmit` — passes for migration files; one pre-existing error in `src/supervisor/__tests__/process-turn.test.ts` (`processTurn` removed from `../index`) is unrelated and was on `main` before this session.
