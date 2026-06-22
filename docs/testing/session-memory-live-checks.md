# Session-Memory (edmini-iee) — Live Verification Script

The on-device checks that clear `edmini-iee` from `needs-verification`. The hard part of (b)/(c) is an
**async harness event landing in the ledger at a controlled moment** — normally produced by the Fly bus
worker off a real Hermes run (slow, non-deterministic). `scripts/ledger-seed.ts` writes those events
directly so the timing is scriptable and you don't wait on Hermes.

## Preconditions

- App open (prod `https://edmini.vercel.app` or local `pnpm dev`). Keep the **events panel** visible.
- **Grading OFF** (default; localStorage `ed_grading_enabled` ≠ "1"). If you've enrolled/enabled grading,
  either turn it off for these checks or note that a non-enrolled voice (incl. TTS) will be *suppressed*.
- A terminal in the repo with `.env.local` present (the seed script reads `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` from it).

## Seed commands (the injector)

```bash
pnpm ledger:seed dispatch <label> [instruction]   # mint a run + write task_dispatch → prints runId
pnpm ledger:seed reply <runId> [kind] [text]      # harness event: run_done|run_output|run_blocked|run_failed
pnpm ledger:seed convo "<userText>" "<edText>"    # a user_utterance + voice_output pair (for memory)
pnpm ledger:seed tail [n]                          # print the last n ledger events (to read seqs/runIds)
```

`reply` kinds → spoken text comes from the payload field: `run_done`→summary, `run_output`→text,
`run_blocked`→question, `run_failed`→error (matches `NARRATE` in `VoiceAgent.tsx`).

---

## Check (b) — cross-session delivery (the registry-rehydration fix)

*An event for a run NOT dispatched in this session must still narrate. Pre-iee: `labelFor`→null→dropped.*

1. `pnpm ledger:seed dispatch research "look into durable execution"` → note the printed `runId` (R1).
   (This run exists in the ledger but was never dispatched by the current UI session.)
2. **Start a voice session.** On start, rehydration registers R1 under label `research`.
3. With the session live: `pnpm ledger:seed reply R1 run_done "found three approaches"`.
4. **PASS:** Ed proactively speaks it — e.g. *"the research task finished — it found three approaches."*
   Events panel shows `Run 'research': run_done`.
   **FAIL:** silence / nothing in the panel for R1 (that's the old dropped-event bug).

> Organic variant (no seed): dispatch a real slow task by voice, reload the page, then let the executor
> reply. Same assertion. The seed path is just deterministic.

## Check (c) — catch-up on resume (delivered while audio was off)

*An event that arrives while the session is stopped must be surfaced on the next start.*

1. `pnpm ledger:seed dispatch export "export the board"` → note `runId` (R2).
2. **Start a session, then stop it.** Stopping persists `lastSeenSeq` (localStorage `edmini.lastSeenSeq`)
   — this is the cutoff. (First-ever session has no catch-up by design, so this start/stop is required.)
3. While stopped: `pnpm ledger:seed reply R2 run_done "exported 412 items"` (its seq is now > lastSeenSeq).
4. **Start a session again.**
5. **PASS:** within a second or two of connecting, Ed proactively says a catch-up — e.g. *"While you were
   away, the export finished — it exported 412 items."*
   **FAIL:** silence.

> Edge to also spot-check: stop → seed TWO replies (different runs) → resume should batch both into one
> "while you were away" turn.

## Check (a) — conversational memory (Recent history + search_history)

1. Seed a little history:
   ```bash
   pnpm ledger:seed convo "let's plan the launch" "sure — what's the goal?"
   pnpm ledger:seed dispatch standup "post the standup at 9"
   ```
2. **Start a session** and ask (speak): *"What were we just doing?"*
   **PASS:** Ed recalls the launch-planning chat and the standup run **without** a tool call (it's in the
   injected `## Recent history` block).
3. **search_history (deeper recall):** push the target out of the recent window, then ask for it:
   ```bash
   pnpm ledger:seed convo "remember the codename is BlueFinch" "got it, BlueFinch"
   for i in $(seq 1 14); do pnpm ledger:seed convo "filler message $i" "ok $i"; done
   ```
   Start a session, ask: *"what was the project codename I mentioned earlier?"*
   **PASS:** the events panel shows `Tool call: search_history`, and Ed answers *BlueFinch*.
   **FAIL:** Ed says it doesn't know / never calls the tool.

> Cleanup: seeded events carry `payload.seeded: true`. To reset, clear the `events` table in Supabase (or
> filter on `seeded`). `pnpm ledger:seed tail 20` shows what's there.

---

## On TTS and making this eval-style repeatable

Short version: **TTS makes the *input* repeatable; the seed script makes the *run lifecycle* repeatable —
and the second is the load-bearing one.** Use both if you want, but they solve different halves.

- **Grading conflict (important):** the speaker grader (edmini-5y7) suppresses anyone who isn't the
  enrolled principal. If grading is ON, a TTS voice ≠ your enrolled voice → **suppressed**. So for TTS:
  keep grading OFF, or enroll the TTS voice once (record TTS samples through the enrollment UI).
- **Pipe TTS cleanly, not through a speaker.** Playing TTS out loud into the mic adds echo/room noise and
  is lossy. On macOS, route a virtual device (e.g. BlackHole) as the mic input and play `say "what were
  we doing"` (or an ElevenLabs/OpenAI-TTS clip) into it. Deterministic audio, no room.
- **What TTS does NOT fix:** the timing of harness events (b)/(c). That's why the seed script exists — it
  removes Hermes from the loop and lets you fire `run_done`/`run_output` on command.
- **The most eval-friendly path (no audio at all):** inject the user turns as **text** over the Realtime
  data channel (`conversation.item.create` with `input_text`) — exactly how `injectNarration` already
  feeds the model. That bypasses mic, transcription drift, and the grader entirely, and pairs with the
  seed script for a fully scripted end-to-end run you could assert on programmatically (read the resulting
  `voice_output` events from the ledger and check them). This is a small "test harness mode" worth building
  if you want CI-grade evals rather than a manual pass — see the follow-up ticket.
