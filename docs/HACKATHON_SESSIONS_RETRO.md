# Ed Mini Hackathon Sessions Retro — Apr 23–24, 2026

This document consolidates the per-worktree `docs/SESSION_SUMMARIES.md` files captured
across 20 Claude Code worktrees during the Ed Mini hackathon weekend (Ship to Prod +
Cognee, Apr 23–24, 2026). The worktrees lived under `.claude/worktrees/` and were
about to be pruned; this is the retro snapshot of what each session shipped before
the worktrees were deleted.

All 20 `docs/SESSION_STORIES.md` companions were the same 234-byte empty template
(MD5 `fcfb462e18e11f91d99fc1c19193a397`) — no narrative content was captured via
`/story`, so nothing from STORIES is included here.

Ordering follows worktree folder mtimes (Apr 23 20:58 UTC → Apr 24 16:54 UTC). The
in-file timestamps appear to be local (BST), and lag the mtimes — they are quoted
as-is alongside.

---

## Timeline

### Sat Apr 23, 20:58 — `gallant-ritchie-c48573`
- **Last commit:** `eab4f38 Initial commit: Ed Mini voice agent project`
- Initial scaffolding worktree. Project bootstrapped.

### Sat Apr 23, 21:45 — `happy-maxwell-73a518`
- **Last commit:** `9d039de feat: client-side API key input for secure key management`
- First pass at moving the OpenAI key off the server — client-side input.

### Sat Apr 23, 21:46 — `recursing-snyder-a1398f`
- **Last commit:** `7934a52 feat: client-side OpenAI API key input with sessionStorage`
- Parallel attempt: client-side key plus `sessionStorage` persistence within a tab.
- New: `package-lock.json` (lockfile committed for the first time here).
- Session ran four ticks (14:46 → 14:57 local) on the same commit — exploring, not committing.

### Sat Apr 23, 21:48 — `gallant-jones-80b352`
- **Last commit:** `0cd9e50 Add browser-side API key input with sessionStorage`
- Third sibling on the same problem — browser-side key + sessionStorage.

### Sat Apr 23, 21:48 — `inspiring-black-f7fe16`
- **Last commit:** `a3357c9 feat: add client-side API key input with sessionStorage`
- Fourth sibling on the same problem. Four worktrees converged independently on the
  same "client-side key + sessionStorage" pattern in ~3 minutes.

### Sat Apr 23, 21:48 — `flamboyant-heyrovsky-0ae991`
- **Last commit:** `1e3a7cb feat: PWA-ready — manifest, service worker, icons, Carbon Warmth UI`
- Distinct track: PWA + UI theming ("Carbon Warmth"). Earlier commit on this worktree
  was the original `a689665 feat: Ed Mini voice agent — Next.js 15 + OpenAI Realtime WebRTC`
  — i.e. this worktree carried the foundational stack choice.

### Sat Apr 23, 22:09 — `fervent-haslett-4799c3`
- **Last commit:** `1fdc3ac fix: capture Ed's audio transcript and reduce VAD silence threshold`
- Two important things in one commit: agent-side transcript capture, and a VAD silence
  tweak so Ed doesn't talk over the user.

### Sun Apr 24, 00:39 — `reverent-hertz-5251de`
- **Last commit:** `bbe67f6 feat: persist API key in localStorage across sessions`
- Upgraded key persistence from `sessionStorage` to `localStorage` — survives reloads.

### Sun Apr 24, 04:24 — `epic-poincare-981560`
- **Last commit:** `bb4fd02 feat: ThreadManager with topic routing, dashboard, and pre-seeded threads`
- Major architectural step: introduction of `ThreadManager`, topic routing, and the
  dashboard surface. Pre-seeded threads land here.

### Sun Apr 24, 05:36 — `kind-rhodes-2d2bf7`
- **Last commit:** `241d2cb fix: agent transcript display + live thread tracking`
- Stitched agent transcripts into the UI; live thread tracking begins working.

### Sun Apr 24, 05:38 — `flamboyant-grothendieck-296d4b`
- **Last commit:** `241d2cb fix: agent transcript display + live thread tracking`
- Sibling worktree on the same commit as `kind-rhodes`. Two ticks, no further changes.

### Sun Apr 24, 06:53 — `great-dirac-f76401`
- **Last commit:** `e79fdaa fix: dashboard updates, thread data, transcript order, sticky layout`
- First sweep at the dashboard UX issues — live updates, transcript ordering, sticky
  layout. Lots of small fixes batched.

### Sun Apr 24, 06:55 — `happy-saha-5d7fb1`
- **Last commit:** `9721e8c fix: dashboard updates, transcript order, sticky UI, generic thread content`
- Iterates on the same surface as `great-dirac`. Adds "generic thread content"
  (likely de-seeding the demo threads).

### Sun Apr 24, 06:56 — `sweet-rhodes-ba7830`
- **Last commit:** `2364e76 fix: dashboard live updates, transcript order, fixed layout, status flash`
- Same area again — adds a status-flash UI affordance and switches to a fixed layout.

### Sun Apr 24, 07:06 — `quizzical-jackson-21f11f`
- **Last commit:** `f0505ee fix: replace status badge text labels with plain 12px dot`
- UI simplification: status badges become a 12px dot. Visual de-clutter.

### Sun Apr 24, 07:22 — `eloquent-tharp-fbfa7d`
- **Last commit:** `bd42dc2 fix: transcript order, classify accuracy, dashboard UX, viewport lock`
- Bundles a classify-accuracy improvement with another transcript-order pass and a
  viewport lock — the demo is being hardened.

### Sun Apr 24, 14:36 — `wonderful-khayyam-8e6899`
- **Last commit:** `20eb2b8 fix: turn-based transcript ordering and viewport lock`
- Final form of transcript ordering: turn-based rather than timestamp-based.

### Sun Apr 24, 16:33 — `elated-williams-fbc4f8`
- **Last commit:** `5ce9cfb fix: clean up UI - remove status chips, categories, simplify dashboard`
- Late aggressive de-clutter: status chips and categories pulled out of the dashboard.

### Sun Apr 24, 16:45 — `beautiful-euler-6fa285`
- **Last commit:** `a889d8c fix: merge thread state on poll to survive serverless cold starts`
- Production-fitness fix: merging thread state on poll so Vercel cold starts don't
  blow away thread state. The dashboard's polling architecture meets reality.

### Sun Apr 24, 16:54 — `heuristic-perlman-8fb0b4`
- **Last commits:**
  - `a889d8c fix: merge thread state on poll to survive serverless cold starts`
  - `664166d fix: gradient bottom bar in VoiceAgent, reset button on dashboard, full conversation transcript panel`
- Final worktree of the weekend. Four ticks (09:52 → 09:59 local). Last shipped:
  gradient bottom bar in VoiceAgent, a reset button on the dashboard, and a full
  conversation transcript panel. Also notable: `tsconfig.tsbuildinfo` got committed
  (not ignored yet).

---

## Highlights — meaningful threads across the weekend

### Stack & foundation
- **Next.js 15 + OpenAI Realtime over WebRTC** is the foundational choice
  (`flamboyant-heyrovsky`, commit `a689665`).
- **PWA**: manifest, service worker, icons, and the "Carbon Warmth" theme also
  landed early on `flamboyant-heyrovsky` (`1e3a7cb`).

### The API key journey
The single most-iterated concern of Saturday evening:
1. Server-side (initial scaffold).
2. Client-side input — converged on by four parallel worktrees within ~3 min
   (`happy-maxwell`, `recursing-snyder`, `gallant-jones`, `inspiring-black`),
   all settling on `sessionStorage`.
3. `reverent-hertz` upgrades to `localStorage` for cross-session persistence.

Worth keeping in mind: there's clear value (and waste) in the parallel-worktree
pattern when four agents independently hit the same answer.

### Voice-agent quality fixes
- `fervent-haslett` — capture Ed's transcript + reduce VAD silence threshold so
  turn-taking feels right.
- `eloquent-tharp` — classify accuracy improvement bundled with viewport lock.
- `wonderful-khayyam` — turn-based transcript ordering (the right model, finally).

### ThreadManager & dashboard arc
The Sunday-morning architectural pivot:
- `epic-poincare` introduces `ThreadManager`, topic routing, dashboard, pre-seeded
  threads.
- `kind-rhodes` → `flamboyant-grothendieck` get the live thread tracking working.
- `great-dirac` → `happy-saha` → `sweet-rhodes` → `quizzical-jackson` are an
  iterative dashboard-UX cleanup loop (live updates, transcript order, sticky/fixed
  layout, status flash, dot indicators).
- `elated-williams` strips chips and categories. Less is more.

### Production-fitness (Vercel)
- `beautiful-euler` + `heuristic-perlman` (`a889d8c`): merge thread state on poll
  so serverless cold starts don't wipe state. This is the key "make the demo not
  embarrass us" fix.

### Last polish
- `heuristic-perlman` (`664166d`): gradient bottom bar in VoiceAgent, reset button,
  full conversation transcript panel — the final demo surface.

---

## Lost-to-template-noise

Every summary was auto-generated by the global hook and largely consisted of
template scaffolding plus a commit pointer. None contained hand-written narrative.
But the commit pointers themselves carried real signal, so every worktree is
listed in the timeline above.

Worktrees whose summaries added essentially nothing beyond their commit message
(i.e. the takeaway is fully captured by the commit subject and they had no extra
modified-files signal):

- `gallant-ritchie-c48573` (initial commit only)
- `happy-maxwell-73a518`
- `gallant-jones-80b352`
- `inspiring-black-f7fe16`
- `flamboyant-grothendieck-296d4b` (duplicate of `kind-rhodes` commit)
- `happy-saha-5d7fb1`
- `sweet-rhodes-ba7830`
- `quizzical-jackson-21f11f`
- `wonderful-khayyam-8e6899`
- `elated-williams-fbc4f8`

These are safe to drop — the commits remain on whatever branch they were merged
into, and the summary content above preserves the takeaway.

All 20 `docs/SESSION_STORIES.md` files were the same empty 234-byte template — no
content lost there.
