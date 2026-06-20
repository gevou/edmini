# edmini — Open Problems (post-v1)

Rough outlines of problems we know we'll need to design, captured so they aren't lost. These are
**not designs** — they're framing + the sharp questions, to be turned into specs later. Newest first.

---

## Voice-provider flexibility — swap the voice model behind a normalized interface

**Status:** backlog (2026-06-20) · bead `edmini-xct`

Don't over-rely on OpenAI Realtime — better voice models keep emerging. Mirror the swappable harness
transport: a **normalized voice-session interface** (events + actions; see
[`edmini-v1-design.md` §6.2](edmini-v1-design.md)) with OpenAI Realtime as one implementation. The
coupling lives in `VoiceAgent.tsx` today (WebRTC/SDP, ephemeral-key session shape, OpenAI event names,
function-calling format, media-track audio); the pure core (ledger, run-registry, narration-queue,
narration-progress) is already provider-agnostic. Worth extracting when a second provider comes into
view or the coupling starts to bite — until then, keep new code behind a thin adapter.

## Partial-delivery recovery — queue the interrupted remainder, don't barge back in

**Status:** rough outline (2026-06-20) · bead `edmini-69p`

On barge-in, **immediately enqueue** the unspoken remainder (optionally with a little of what *was*
spoken, for context) — do **not** auto-resume speaking it. Two reasons:

- **The barge may diverge the conversation.** The user interrupted to redirect; Ed must not plow back
  into the old narration. The remainder waits, and *when the conversation returns to it* Ed re-frames
  with context — *"as I was saying earlier about X, …"*.
- **The user may have read it.** The text is on screen (the conservative-cursor visual, `edmini-mb0`,
  shows spoken vs unspoken), so the user can just read the rest and confirm — and the queued item is
  **dismissed** without ever being spoken.

So an interrupted remainder is just another **pending/unread item**: it slots into the existing narration
queue (9ex; v3's "unread items wait, read on pull / on return") as a low-priority entry, re-surfaced
contextually and dismissable, never barging in. The bias stays conservative (assume *less* was
delivered — people repeat when interrupted).

Mechanism: the cursor (`edmini-mb0`) gives the spoken/unspoken split + accurately-measured elapsed audio
time → `conversation.item.truncate(audio_end_ms)` so the model's own context reflects what was heard; the
remainder is queued with a context prefix; re-surfacing reuses the narration queue + a re-frame;
dismissal on user confirmation. See [`edmini-v1-design.md` §6.1](edmini-v1-design.md).

## Input addressivity — "focused" vs "public" listening

**Status:** rough outline (2026-06-19) · design later · bead `edmini-qo3`

### The problem
edmini's voice loop today responds to **all** detected speech: OpenAI Realtime server-VAD treats
every utterance as a turn and generates a reply. In any real setting — a room with other people, a
side conversation, background talk — edmini should **listen continuously but only respond when the
User is actually addressing it.** Otherwise it interjects into conversations it isn't part of (the
"noisy environment" problem).

### Why it's hard (and interesting)
- **No clean wake word.** The goal is natural addressing, not "Hey edmini" every time. Addressivity
  has to be inferred from content and context (named mention, directed second-person request,
  conversational continuity, an explicit cue) — and inference is fallible in both directions.
- **Decide-later / retroactive promotion.** edmini can't just discard non-addressed audio, because
  whether something was addressed to it may only become clear *after the fact*. The User might set
  context talking to a person ("let's do Tuesday at 3") and then turn to edmini ("book that"). The
  "book that" needs the earlier ambient context. So edmini must **remember ambient input it chose not
  to act on**, and be able to **promote it to "addressed to me" retroactively.**
- **It inverts the v1 thesis.** v1 "attention accounting" is edmini protecting the *User's* attention
  across many runs — the **output** side. This is the **input** side: edmini computing the relevance
  of incoming audio *to itself* ("was I addressed?"). A second attention problem, at the other end of
  the channel.

### Sketch (not a design): focused ↔ public
- **Focused** — active dialogue with edmini; respond to everything, like a normal back-and-forth
  (today's behavior).
- **Public** — ambient listening; edmini transcribes and buffers but stays silent unless explicitly
  addressed; it can pull from the buffer retroactively when later addressed.
- Transition rules, addressivity detection, and buffer scope/expiry are the open design.

### ⚠️ Distinguish from v3's rejected "modes"
v3 deliberately rejected `ambient`/`focused`/`meeting` mode *machinery*
([`supervisor-architecture-design-v3.md` §6](supervisor-architecture-design-v3.md)) — but that was
about **output / surfacing**: when edmini proactively speaks or notifies, resolved as
foreground-vs-background *app focus*. This "focused/public" is a **different axis: input
addressivity** — whether edmini responds to a given utterance *at all*. The naming collides; the
concept doesn't. Any future design must keep the two axes separate (or pick non-colliding names).

### Where it touches the system
- **The ledger.** Ambient (un-acted-on) speech is still input — log it as a distinct event (e.g.
  `source: "user"`, `kind: "ambient_utterance"` / `heard`), so "decide-later" promotion is a
  re-interpretation over the ledger rather than lost in-memory state. Mirrors how interpreted harness
  events sit alongside the raw `discord_message` rows.
- **Distinct from the "invoker" role.** The future run-less *invoker* inbound role
  ([concurrent-run-narration spec §10](../superpowers/specs/2026-06-19-concurrent-run-narration-design.md))
  is *external* senders (email/IoT/webhook). Ambient audio is the User's own near-field speech. Both
  are inbound-but-not-a-run, but different sources.
- **Realtime mechanics.** Server-VAD currently auto-responds. Public mode likely needs a gating layer
  (suppress `response.create`, or `tool_choice`/turn-detection changes) that decides *per utterance*
  whether to generate a response — a real change to the session config / voice loop.

### Open questions for the design phase
- How is "addressed to edmini" detected — name, directed second-person, continuity, explicit cue?
  What are the relative costs of false positives (interjecting) vs false negatives (ignoring)?
- Ambient buffer size/retention, and **privacy** (always-listening + buffering is sensitive).
- How does the User enter/exit focused mode — a word, sustained dialogue, a UI control?
- Cost of transcribing and holding all ambient audio.
- Does this want the v3 companion visual surface (an "what I heard but didn't act on" view)?
