# edmini — Project Status

## Branch
`claude/heuristic-perlman-8fb0b4` (worktree at `.claude/worktrees/heuristic-perlman-8fb0b4`)

## VCS
git

## Deployed
https://heuristic-perlman-8fb0b4.vercel.app (production, Vercel)

## Recent Changes (commit 664166d)

### Task 1: VoiceAgent gradient bottom bar
- `src/components/VoiceAgent.tsx` — bottom bar `background: bgColor` replaced with `linear-gradient(to bottom, transparent, rgba(14,10,4,0.85) 30%, rgba(14,10,4,1) 60%)` so transcript messages fade under it. Header `background: bgColor` unchanged.

### Task 2: Dashboard reset button
- `src/app/api/threads/reset/route.ts` — new `DELETE` handler that calls `resetThreads()` and returns `{ ok: true }`.
- `src/lib/thread-manager.ts` — added `resetThreads()` export (sets `threads = []`, saves).
- `src/app/dashboard/page.tsx` — "reset" button in header (before "voice →"), calls `DELETE /api/threads/reset`, sets threads state to `[]` on success. Hover turns red.

### Task 3: Full conversation transcript panel
- `src/lib/conversation-log.ts` — in-memory log with `getConversationLog()`, `appendConversationMessage()`, `clearConversationLog()`.
- `src/app/api/conversation/route.ts` — `GET /api/conversation` returns full log.
- `src/app/api/conversation/message/route.ts` — `POST /api/conversation/message` appends a message.
- `src/components/VoiceAgent.tsx` — `postTurnToThread` now first posts both user+Ed messages to `/api/conversation/message`, then continues with thread classification as before.
- `src/app/dashboard/page.tsx` — left 1/3 panel shows full chronological conversation (polls every 5s, auto-scrolls on new messages). Thread cards moved to right 2/3, 2-col grid on lg screens.

## Active Beads Issues
- `edmini-d8h` — closed, label: `needs-verification`

## Architecture Notes
- Thread store: in-memory + `/tmp/ed-threads.json` (file may not persist in serverless).
- Conversation log: in-memory only (no file persistence — resets on cold start, same as thread store before poll merge).
- Serverless note: both stores reset on cold start; the dashboard's `mergeThreads` logic preserves client-side state across cold starts for threads. Conversation has no equivalent merge (always shows server state).
