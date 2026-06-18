# Supervisor Architecture: Analysis & Design Decisions

> Status: living decision record and reasoning trail, maintained alongside the v3 spec (which now exists and keeps evolving). This is the *why* behind the design, not the spec itself. It captures conclusions, the paths walked, and the compromises settled, across several sessions. Parts 1 to 8 cover the original v2-to-v3 reasoning; Parts 9 to 12 capture the later decisions (the executor harness, the inbox framing, the visual surface, the future meeting modes).

## Session Overview

This document captures the design discussion for edmini's supervisor component, moving from v2's overloaded queue model to a clean separation between the Project Manager (work tracking) and Supervisor (attention management) domains. The goal is to establish a deterministic spine that can ship, with well-defined boundaries between what is decided now and what is delegated to the LLM layer for later refinement.

---

## Part 1: The Core Separation

### What Moved Where

**v2 problem.** A single ontology (project, task, output, queue) was doing two incompatible jobs at once: tracking work and managing attention. This caused contradictions in how items flowed through the system (the clearest being the "silent output" that was simultaneously queued, unread forever, and polluting badge counts).

**v3 solution.** Split into two domains with a narrow interface between them.

**Project Manager domain** (work tracking, back-of-house)
- Entities: project, task, run, output
- Responsibility: decompose work, track execution state
- Emits: an event stream (outputs carrying a project tag and a notify hint)
- Does NOT: make surfacing decisions, or touch the conversation

**Supervisor domain** (attention management, user-facing)
- Entities: conversation, topic, thread (conversational), meeting, focus, memory
- Responsibility: manage attention flow. Disambiguate multiplex user input (one utterance can raise several topics) into topics, observe the output stream, decide what to surface and when, escalate topics that need different treatment, and narrate to the user. The user's input is multiplex; the voice channel is serial. The supervisor bridges the two. "Single-stream" describes the channel, never the user's mind.
- Consumes: output stream from PM, user messages, out-of-band signals
- Does NOT: decompose work, or track executor lifecycle. The PM tracks which executor handles what; the supervisor tracks how the user's intents interleave across topics and threads. Multiplexing therefore spans both: the executor-tracking half is PM, the intent-interleaving half is Supervisor.

### Why This Split Works

1. **Coherence by specialization.** Each domain has one job. The PM solves a work-decomposition problem. The supervisor solves a focus-preservation problem.
2. **Interface isolation.** The two communicate through a narrow contract (output stream with tags and hints). Neither needs the other's internals, which makes a later physical split (separate processes or agents) trivial.
3. **Dissolution of contradictions.** v2's "silent output" problem vanishes: the PM generates the output, the supervisor's delivery view filters it. One source of truth, two views.

### Terminology Resolution

- **"Thread"** now means only the conversational thread (a strand the user picks up and puts down). Previously it also meant "one executor's workstream," which was the root confusion.
- **"Run"** (or "job") replaces "executor's workstream" in the PM domain.
- project, task, and run stay in the PM domain and never appear in supervisor logic.

### Compromise on physical split

We agreed the conceptual separation happens now and is free. The physical split into separate processes or agents is deferred until sub-agents actually exist, since a network boundary buys nothing before then and adds drift risk. The interface (tagged output stream plus notify hints) is stable in either topology, so starting in-process and pulling apart later costs no reshaping.

---

## Part 2: The Supervisor's Entity Model

### The Graph Shape

The supervisor domain is many-to-many overlays on a linear spine, not a hierarchy. This contrasts deliberately with the PM domain, which is a tree (project > task > run > output).

**Spine:** the message log (user utterances plus supervisor narration), ordered in time.

**Overlays (all M:N):**
- topic to message (a message can touch several topics; a topic spans many messages)
- topic to thread (a thread can involve several topics; a topic can span several threads)
- topic to output (an output is placed onto one or more topics)
- thread to message (messages belong to threads)

**Conclusion:** this is a graph, and that is the right shape. The decision was to adopt the graph *model* now (so v3 does not bake in a tree it later has to tear out) while deferring the graph *machinery* (graph DB, traversal-based relevance, embeddings as edges). Plain relational join tables back it fine at single-user scale.

### Core Entities

**Conversation.** The linear spine: the ordered sequence of messages. Immutable once recorded. Everything else is structure imposed on top of it.

**Topic.** A semantic grouping of conversation around a project or theme. Created by user messages or by supervisor decision. Not a partition of the conversation; topics overlap.

**Thread (conversational).** A strand the user can pick up, put down, and return to. Distinct from the PM's "run": thread is about conversation continuity, run is about executor state.

**Meeting.** A bounded, possibly scheduled focus session, optionally with an agenda. Not a separate surfacing mode (we explicitly rejected re-introducing mode machinery). It is a named grouping of topics with optional temporal boundaries, useful for focus framing and retrospect.

**Focus (internal, not user-facing).** The optimization target, not a stored entity the user manipulates. It is the active topic set plus active thread plus the cost of breaking focus right now. The supervisor maintains an internal "what is active now" state in order to optimize for it.

**Memory.** The recall layer: summarized, searchable context optimized for retrieval. Not the system of record (see Part 5).

### Provenance & Inheritance

When the supervisor creates a task in the PM, the task carries a topic binding from birth. Any output from that task inherits that binding. This is the deterministic default path and needs no relevance computation. The fallback (relevance engine) is invoked only where provenance fails. See Part 7.

---

## Part 3: The Supervisor's Three Phases (Deterministic Spine)

The supervisor's job decomposes into three sequential phases. Keeping them separate is what prevents importance-scoring from creeping back in under cover of "surfacing logic."

### Phase 1: Observe

Output arrives from PM, supervisor appends a ledger event, updates the topic and thread overlay.

On the input side, a user message is the symmetric case: the supervisor disambiguates a multi-topic utterance into its topics and updates the overlay from the other end (see Part 7, two triggers). Input is multiplex; the overlay absorbs it without forcing linearity.

Deterministic rules:
- Every output becomes a ledger event.
- Inherit topic from the task's topic binding.
- If content diverges significantly from the inherited topic, invoke the relevance engine (deferred logic, leaves a trace).
- Maintain the M:N graph: the output now belongs to topic(s) and thread(s).

Outcome: a complete, reconstructable account of what happened. No information loss.

### Phase 2: Decide (Surfacing)

Decide whether and how to surface each output to the user via voice.

Inputs to the decision:
- The configured notify hint from PM (`immediate | queued | silent`), with optional per-output override.
- Topical relevance: how well does this output connect to the active topic set?
- Thread continuity: does this output belong to a thread the user is currently in?
- Executor state: is the producing thread blocked (stalling work)? If so, raise assertiveness by one level as policy, not as an importance judgment.

Voice assertiveness levels:
- `immediate`: may interject (focus-break, justified by configured intent or by blocking).
- `queued`: surfaces on pull, shows as unread, folds in if topically relevant.
- `silent`: never on voice; other channels as configured.

Confidence gate: low relevance-confidence biases toward lighter surfacing (heads-up rather than fold-in), never toward silence. A wrong fold-in is a focus-break with a non-sequitur attached, which is worse than a heads-up.

Deferred to the LLM layer: the relevance score itself, the confidence in it, and the fold-in vs heads-up choice (except the confidence gate).

Output: a surfacing decision per output, logged as an event (who decided what, on what signal).

Decide also covers **escalation recognition**: noticing when a topic cannot be resolved in a couple of turns and needs different treatment. Escalation is the load-bearing concept; a meeting is only one escalation mode (others: raise the notify level, pull in more context, invoke a specific executor, queue for focused work). The supervisor owns recognizing when and which kind to escalate, not the escalation action itself, which can evolve independently. Recognition is model-delegated and logged, like the other judgments here.

Key principle: the supervisor computes *relevance* (coherence with the current conversation, a legitimate semantic computation) and responds to *structural facts* (a blocked executor costs real time). It does not compute *importance*; importance is the user's value judgment, configured via the notify hint.

### Phase 3: Narrate

Take the surfaced outputs and speak them to the user.

Deterministic rules:
- Fold topically relevant `queued` items into natural speech; on-topic items do not break focus.
- Heads-up items that are not folded get lightweight explicit turns ("by the way...").
- Hold focus on the active topic and thread; do not whipsaw between unrelated items.
- Acknowledge user actions in the thread they belong to.
- Chunk long responses, multiple questions, or complex information into digestible pieces, so each turn stays absorbable and gives the user natural ack and interruption points.
- Handle barge-in: when narration is interrupted (full text exists, audio is produced incrementally), track where in the response the interruption landed (the user may be reacting to that exact point) and decide whether the unconveyed tail still matters. If it does, it re-enters the surfacing queue as a new output and reuses the existing relevance-plus-confidence logic; if not, it is dropped. A barge-in implicitly acknowledges the part already spoken.
- Choose modality: not everything should be spoken. When content is dense or structured (comparisons, options, tables, long results), show it on a visual surface and let the voice give an overview and walk through it one step at a time. This is the visual channel carrying content (distinct from peripheral awareness cues), and it relieves the serial bottleneck by moving scannable material off the single voice stream.

Deferred to the LLM layer: phrasing, weaving multiple outputs together, transitions between topics, returning to a prior thread.

Output: speech to the user.

---

## Part 4: Deterministic vs. Nondeterministic

### The Rule

- Decide now: anything with a clear rule that does not require judgment.
- Defer to the LLM: anything needing semantic understanding, confidence estimation, or UX judgment.
- Discipline: every deferred decision leaves a trace in the ledger, so it can be audited and, if a stable pattern emerges, promoted to deterministic logic later. The reverse is also possible (pulling something back into the LLM layer if a rule proves too brittle).

### Deterministic (the v3 spine)

1. Provenance-based topic binding (task carries topic, output inherits).
2. Ledger events (every happening becomes an append-only event).
3. Notify-hint routing (the hint guides assertiveness).
4. Blocked-executor escalation (raise assertiveness one level; policy, not importance).
5. Explicit ack rules (which user actions count as acknowledgement).
6. Event schema (what is logged and in what form).

### Deferred to the LLM layer

1. Relevance computation against the active topic set.
2. Confidence in that relevance.
3. The fold-in vs heads-up choice.
4. Out-of-band placement (when provenance fails).
5. Narration strategy (phrasing and sequencing).

### Logging the Deferral

Each LLM decision is logged as an event, for example:

```
output_surfaced_as {
  output_id,
  decision: interject | fold_in | heads_up | defer | log,
  signal_summary: "relevance 0.87 to export-topic, confidence 0.92",
  phase: 2
}
```

This is the audit trail. When a pattern stabilizes (for example, fold-in reliably succeeds when relevance exceeds some threshold), that pattern can be promoted into a deterministic rule and backtested against ledger history.

### Compromise

We agreed not to settle the implicit-vs-explicit boundary by reasoning. It will be found by trial and error, instrumented by the ledger trace and by visual feedback (Part 7). Ship with reasonable heuristics in the LLM layer, observe, then harden what proves stable.

### Self-improvement (future vision)

The same logging that enables hardening also lets the supervisor get better over time, scoped to the attention job (this is distinct from the executor's own self-improvement, which edmini does not touch). The ledger records every surfacing and escalation decision with its signal, and every user response (acknowledged, snoozed, interrupted, corrected, followed or overridden). A feedback loop over that record can learn the user's patterns: when to interrupt, when and how to escalate, how they prefer to resolve a conversation, how much detail per turn before they get restless, whether they barge in early or late and what that signals. Recall supplies the priors, the supervisor's judgment makes the call, and the ledger lets a stabilized pattern be promoted from heuristic to rule. This is the supervisor's analogue to Hermes self-improving, narrowed to attention management. It is future vision, not v1, but the architecture (decision logging here and in Part 8) already enables it without new machinery.

---

## Part 5: The Ledger & Recall Memory Split

### The Contradiction in v2

v2 used one "ledger" for two incompatible purposes:
- Accountability: a complete record of everything that happened (including silent inter-agent chatter), retained for the long term.
- Recall: searchable, summarized context for the LLM to reason over.

These have opposite retention policies. Accountability wants everything kept. Recall wants summarization and forgetting.

### v3 Solution: Two Separate Systems

**Accountability ledger** (you own this)
- Append-only, immutable, complete.
- Stores every event: outputs emitted, deliveries, acks, snoozes, executor state changes, topic placements, surfacing decisions.
- Retained per your policy (long, ideally complete).
- Minimal payload per event (pointers, not full bodies).
- System of record. Nothing in the supervisor exists outside this log.
- A boring SQL table is enough. No Kafka required.

**Recall memory** (third-party layer, optional)
- Optimized for retrieval (embeddings, summarization, semantic search).
- Allowed to summarize and forget, because it is not the system of record.
- Sits beside the ledger, not on top of it.
- Used by the LLM layer for context and relevance computation.
- This is also the natural home for the topic graph, derived from the flat ledger.

### Why This Split Is Critical

1. The accountability invariant (Part 8) stays honest: nothing is forgotten unless you explicitly policy it on the ledger side.
2. Retention is clear: the ledger keeps everything, recall forgets by design, and the two policies do not fight.
3. LLM decisions are auditable: the ledger holds the trace, so a bad relevance call is visible after the fact.
4. The sub-agent future is safe: silent inter-agent chatter goes to the ledger for accountability and is summarized by the recall layer for volume, so the deterministic spine never floods.

### Evaluating Third-Party Memory Products

The lens: does it keep a complete trail, or does it compress by design? Most compress. That makes them a fine *recall* layer but an unsafe *ledger*. So:
- Red flag: products whose core value is summarization and that do not preserve a complete trail. Do not let your accountability guarantee inherit their forgetting.
- Green flag: products that sit beside a ledger, preserve complete data, and layer recall on top.

The two "future" ideas (a graph approach, and adopting a third-party memory solution) collapse into one decision: the graph lives in the recall layer, derived from the flat append-only ledger, never in the ledger itself.

---

## Part 6: Notify as a Voice-Channel Directive

### The Reframe

`notify` is not a global importance judgment. It is a voice-channel assertiveness level, and one of several inputs to the surfacing decision.

The user already has email, push, browser notifications, and so on, each with its own routing. `notify` governs only the voice channel, which is special because it is the one channel that synchronously breaks focus. The other channels are async or pull, so they never need a fold-in-vs-defer decision. That asymmetry is the entire reason the supervisor's surfacing logic exists.

### The Three Levels

- `immediate`: voice may interject (a focus-break the user has sanctioned, or a structural reason like blocking).
- `queued`: voice surfaces on pull and shows as unread; other channels route per their own settings; may fold in if topically relevant.
- `silent`: never voice; other channels as configured; always logged.

### How It Composes With Relevance

Even a `queued` item can fold into ongoing voice narration for free when its topical relevance to the active focus is high, because that is natural continuation rather than a focus-break. `immediate` is the override that interjects regardless of relevance. Everything else is relevance deciding whether queued items ride along now or wait to be pulled.

---

## Part 7: Acknowledgement & Topic Assignment (Trial & Error)

### Acknowledgement: Implicit vs. Explicit

Two modes run in parallel, and the rule is not one sentence; it is "implicit for folded, explicit for not."

**Folded-in outputs** (woven into narration)
- Implicit ack: a topical user utterance on that project or topic counts as acknowledgement.
- Cost: false positives (an unrelated topical remark can accidentally ack an output). Usually acceptable.

**Heads-up outputs** (explicit "by the way..." items)
- Explicit ack only: the user must dismiss, confirm, or otherwise acknowledge.

We agreed the precise boundary between implicit and explicit will be found by trial and error, not decided up front.

### Topic Assignment: Two Triggers

Topic assignment is not solely a side effect of message handling. It has two triggers on independent clocks, both writing to the same topic structure from opposite ends:

1. User-message time: messages move focus (which topics are active) and may spawn new topics or tasks.
2. Output-arrival time: an output asks to be placed against the topic graph, then surfaced. These arrive asynchronously, usually when the user is not talking.

So topic assignment is a shared service that both the message handler and the output handler call.

### Topic Assignment: Default + Fallback

- Deterministic default: task carries a topic at creation, output inherits it. Fast path, no relevance computation. This handles the common, supervisor-initiated case.
- Nondeterministic fallback: invoked only when provenance fails. Three cases where it fails, two of which are exactly what the accountability invariant exists for:
  - Out-of-band outputs (user posts into the bus channel; sub-agents emit inter-agent outputs never spawned as discrete tasks). No task to inherit from.
  - Content that diverges from the task's origin topic (a "deploy export" task that returns a "chips auth change" failure). Inheritance would file it under the wrong topic and miss the surprising attachment.
  - M:N spread (a task born from a message touching several topics has no single topic to inherit).

Provenance is therefore a strong prior, not a replacement for relevance.

### Visual Feedback & Iteration

Expose (in dev at minimum, possibly a debug view for the user):
- which topic(s) each message belongs to,
- which thread each message is in,
- which topic(s) an output was assigned to,
- why a surfacing decision was made (relevance, confidence, notify level).

This visibility is the feedback loop for finding the boundaries. Patterns will surface (fold-in works above some relevance; implicit-ack false positives cluster above some topic-overlap), and those become the next iteration of deterministic rules. The ledger keeps the audit trail, so any new rule can be backtested against history.

### The Meta-Point

Do not try to design ack and topic placement perfectly up front. Build the logging, ship with reasonable heuristics, iterate on observed signal. Start shipping when the deterministic spine is in place, not when every heuristic is solved.

---

## Part 8: The Accountability Invariant (carried over from v2 §0)

edmini is the supervisor and the layer accountable for all the work. The invariant is awareness, not exclusivity: edmini must never go blind and must always be able to account for what happened. If the user reaches into a back-of-house surface directly (for example posting into a bus channel), edmini detects and incorporates it rather than preventing it.

In the v3 model this reduces to a single sentence: every happening must become a ledger event. That covers the out-of-band cases directly. The one honesty cost worth stating: detection of external writes is eventually-consistent rather than truly continuous, so there is a brief window between an external action and its corresponding event. The invariant still holds in substance, because nothing reaches an executor, and no executor acts, without a corresponding event landing in the ledger.

---

## Part 9: The Executor Is a Harness; the PM Is an Adapter

A later decision that reshapes Part 1: the PM domain is not built from scratch. The work of running a task (tool calling, model routing, skills, scheduling, transports) is what an agent harness already does, so the PM is a thin **adapter** over a harness, not a reimplementation. v1 uses Hermes.

**Muscles versus nervous system.** The harness supplies the muscles (execution, tools, transports, its own memory and self-improvement). edmini is the nervous system: the observable work surface the supervisor can be accountable to. So the PM shrinks to a minimal observability contract that maps the harness's boundary events (run start, blocked-and-asking, output, done, failed) into the run lifecycle and the tagged output stream. It is not a normalization layer and must not flatten executors into a uniform facade; executors stay varied and attributed (non-masking).

**The harness is the largest §0 surface.** A harness with its own action loop, memory, and messaging gateways is exactly where things could happen without edmini seeing them. So "detect and incorporate" becomes concrete: instrument the harness boundary so every user-relevant crossing becomes a ledger event. But awareness is scoped to the boundary, not the internals. The harness may self-improve and be arbitrarily complex inside; edmini neither gates nor surveils that. Surveilling the executor's cognition is a non-goal.

**Two memory systems, one authoritative.** The harness ships its own memory and user modeling. Treat it as recall (Part 5), never the ledger, because it summarizes and forgets by design. Running two memory systems is fine as long as exactly one is authoritative and it is edmini's append-only ledger.

**The voice channel is edmini's.** Harness transports are text and chat. The focus-coupled voice surface, the whole reason the supervisor exists, is edmini's to build on top.

---

## Part 10: The Inbox Framing

The cleanest way to see the PM-as-adapter is the email analogy. A good mail assistant manages an inbox the user cannot read all at once: it triages, learns VIP senders, threads related messages, and lets the rest wait without losing it. Executors posting to a shared bus are the same problem.

**The projection vindication.** A mail assistant never keeps a separate email state machine; it infers thread state from the messages (awaiting reply, resolved). That is exactly the projection model (Part 3): run state is inferred from messages on the bus, so the PM stops being a domain to build and becomes "how edmini reads the bus." Most of the supervisor's machinery is the email model in other words: read/unread is the unread flag, importance-configured-plus-relevance-computed is VIP senders plus threading, persistent-and-tagged is labels and threads.

**Where the analogy stops.** It is close to 1:1 for the management layer (what is managed) and silent on the delivery layer (how it is delivered). A mailbox is scanned visually at the user's pace; edmini serializes the same inbox into single-stream voice, which is synchronous and interrupts. So the framing simplifies coordination, the part that was already thin, and leaves the attention layer, the real work, untouched.

**Discord as the v1 bus.** Hermes already speaks Discord, so it gives transport, persistence, and threading for free, and reading the channel is the §0 stay-aware posture made concrete. Guardrail: Discord is the bus, not the ledger. Persistent is not authoritative. Read the channel, but tap it into edmini's own append-only ledger, or you inherit Discord's retention and uptime as your accountability guarantee.

---

## Part 11: The Visual Surface, Modality, and the Badge Ruling

edmini ships a companion visual surface from day one, even though it is not feature-rich.

**Voice and screen are a division of labor, not rivals.** Voice is the focus-coupled front door; the screen is the parallel, scannable companion it navigates. The surface does three jobs the design already implied, now in one place: the inbox or queue view with unread badges (ambient awareness kept off the voice stream), rendering dense content for the modality walkthrough, and the feedback view of topic and surfacing decisions (formerly dev-only).

**Modality: show, do not only tell.** A standing Narrate-phase judgment is whether content is better shown than said. Dense or structured output goes on the surface while the voice gives an overview and walks through it one step at a time. This is distinct from peripheral awareness cues; it is the visual channel carrying content. It also relieves the serial bottleneck directly: routing scannable material to the parallel visual channel frees the single voice stream for navigation. Which to show versus speak is a model-delegated, logged, learnable judgment.

**Badge ruling.** Seeing an unread badge is awareness, not acknowledgement. A glance does not clear it; only acting on the item does. Badges persist until acted on, which preserves the anti-evaporation guarantee even though the screen now makes outputs visible without speaking them.

---

## Part 12: Escalation and Future Meeting Modes

Escalation, not the meeting, is the load-bearing concept. The supervisor recognizes when a topic cannot be resolved in a couple of turns and needs different treatment, then picks a mode: raise the notify level, pull in more context, invoke a specific executor, queue for focused work, or initiate a meeting. The supervisor owns the recognition (when, and which mode); the escalation actions are separate concerns that can evolve independently. Recognition is model-delegated and logged; how it works (recall priors, supervisor logic, or both) is deliberately unresolved.

**Future meeting modes (flagged, not designed).** A meeting could become a coworking session, where edmini pulls in executor capabilities and tools to collaborate rather than only discuss. A sibling mode is collaborative checklists and workflows the user and edmini advance together, the voice guiding step by step while the surface shows live state.

**The new object, and the boundary it tests.** Workflows introduce a stateful shared artifact, neither a conversation message nor an executor output. Reassuringly, its progress is just a ledger projection (step-started, step-done), so no new state machinery. The boundary to watch is the same one coworking raises: workflow steps can interleave user actions with delegated executor runs, which edges the supervisor toward orchestration. The architecture-preserving reading is that edmini tracks and guides the workflow and delegates the executor-steps to the PM, rather than performing them itself. Whether a workflow is a first-class entity or a structured object on a topic is left open.

---

## Open Items (mirrors v3 §10)

Tracked authoritatively in the spec as §10; restated here so the trail stays self-contained.

1. Final noun for the PM workstream (run vs job); the spec uses "run".
2. Whether `project` is a first-class PM entity or a tag on `task`.
3. Bulk acknowledgement: per-item events, or one `project_acknowledged` the projection expands (recommended).
4. Snooze semantics (time-based, topic-based, or both, and who sets duration) and the interaction when a snooze elapses while backgrounded.
5. Output identity and addressing (stable IDs so ack and snooze can target items).
6. Which third-party recall-memory layer, if any, evaluated against the Part 5 lens.
7. Escalation recognition: when a topic should escalate and which mode it needs; likely recall priors plus supervisor judgment plus ledger hardening. Left unresolved rather than designed.
8. A partial-delivery state in the output lifecycle so barge-in can record where narration was interrupted.

Resolved since the early draft: the output lifecycle is now a projection over the ledger with a `logged` terminal for silent items; run terminal states are distinct (`failed`, `cancelled`); and the day-one build target, including the companion visual surface, is settled (Parts 9 and 11).
