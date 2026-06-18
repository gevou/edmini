# Supervisor Architecture — Thesis

**Date:** 2026-06-09
**Companion to:** Supervisor Architecture Design (v3)

## The thesis

A voice supervisor coordinating several asynchronous agents for one human is not solved by a better scheduler. It is solved by treating the problem as **attention accounting**: separate the work from the user's attention to it, let the user own what counts as *important* while the system owns only what is *relevant* and what is *structurally true*, and keep a complete, accountable record so that nothing the user produced ever silently disappears.

Everything else in the design is a consequence of that sentence.

## The problem it answers

One human, N agents working asynchronously, one serialized output channel (speech, or notifications when the app is not in focus). Outputs arrive at unpredictable times. The naive instinct is to build a smart scheduler that decides what to show when. That instinct is wrong, because the binding constraint is not throughput. It is the human's attention, which is single-stream for audio and expensive to interrupt. The architecture has to be built around protecting attention, not around moving outputs.

## Core claims

1. **The ceiling is focus, not thread count.** What limits simultaneous voice work is how often the user's focus is broken and how many produced-but-unacknowledged results they are mentally tracking. Adding agents does not raise cognitive load if neither of those two quantities rises.

2. **Importance is the user's; relevance is the system's.** Whether a result *matters enough to interrupt* is a value judgment only the user can make, so it is configured, never deduced. Whether a result *connects to what is being discussed now* is a question of semantic coherence, which the system legitimately computes. Conflating these is the original sin: it is what made earlier designs try to score importance.

3. **There is exactly one more thing the system may act on: structural fact.** A blocked agent is objectively stalling work. That is not an importance guess; it is a resource state with a real cost. Structural facts are the only system-side signal allowed to raise how assertively something surfaces.

4. **Work-tracking and attention-management are different problems and must not share an ontology.** Decomposing and tracking work (projects, tasks, runs) is one job. Holding the user's focus (conversation, topic, thread, the cost of interruption) is another. One ontology serving both is what produced the contradictions the design exists to remove.

5. **Serial-by-default is the feature, and single-stream is the channel.** The voice channel is serial and human audio attention is single-stream; pretending otherwise produces interfaces that thrash. But the user's *input* is multiplex: one utterance can raise several topics. So the supervisor's job is to manage that multiplicity on the way in and re-serialize it on the way out, not to assume the user thinks in a straight line. A system that stays on one topic until the user opts to switch, and parks everything else, is what makes N-agent voice tolerable. The tolerance comes from the discipline of deferral, not from cleverer interleaving.

6. **Nothing is lost; deferral is the mechanism.** Every output persists, tagged to its topic, and stays unread until explicitly acknowledged. Focus is preserved by holding things back, never by dropping them. The record of held-back work is also the accountability record.

7. **The system of record must not be the thing that forgets.** Accountability needs a complete, append-only trail. Recall needs summarization and forgetting. These are opposite retention policies, so they are two systems: a ledger that keeps everything, and a recall layer that is allowed to forget because it is not authoritative.

8. **Voice is the only focus-coupled channel, and that asymmetry is the whole reason surfacing logic exists.** Email, push, and browser notifications never interrupt a live conversation; they are pulled or fired and read later. Voice interrupts now. So the configured notification intent is really a voice-channel assertiveness setting, and the fold-in-versus-defer decision exists only because one channel is synchronous with the user's attention.

9. **The supervisor escalates, it does not only surface.** Moment-to-moment surfacing is not enough; some topics cannot be resolved in a couple of turns and need different treatment. Recognizing *when* a topic must be elevated, and *which* mode it needs (a focused meeting being only one option, others being a raised notify level, more context, or a specific executor), is part of attention management. The supervisor owns the recognition; the escalation actions are separate concerns that can evolve on their own.

10. **Voice should not carry what a screen carries better.** The serial voice channel is the bottleneck (claim 5), so part of the answer is to stop forcing dense, scannable content through it. Comparisons, option sets, tables, and long results go on a parallel visual surface while the voice gives an overview and walks through them. Choosing what to show versus speak is part of protecting attention, not a separate feature.

## What follows (design commitments)

- A user-configured intent per task (may this use the voice channel, and how assertively), enforced by the supervisor, never a computed importance score.
- A persistent, topic-tagged store where outputs stay unread until acknowledged.
- A semantic relevance judgment that decides whether a deferred output may fold into the current topic for free, gated by confidence so that uncertainty produces a light heads-up rather than a wrong interruption.
- A clean split between an append-only accountability ledger and a lossy recall layer.
- Two domains behind a narrow interface, so work-tracking can evolve without touching attention-management.
- Narration that chooses a modality rather than speaking everything: dense or structured content is shown on a visual surface with a spoken overview and walkthrough, so the serial voice channel is not forced to carry what a parallel visual channel conveys better.

## What it rejects

- **Scoring importance.** The system does not rank what matters to the user.
- **One queue doing two jobs.** Delivery and accountability are different views, even if they share storage.
- **Surfacing "modes."** No ambient/focused/meeting rulesets. There is foreground behavior and there are notification settings, and a meeting is just a framing over foreground focus.
- **A forgetful system of record.** A summarizing memory product is a recall layer, never the ledger.

## How it gets better (future)

The supervisor is meant to improve at its own job over time, the way the executor improves at its. The ledger already records every surfacing and escalation decision with its signal, and every user response to it (acknowledged, snoozed, interrupted, corrected, followed or overridden). A feedback loop over that record can learn the individual user: when to interrupt, when and how to escalate, how they like to resolve a conversation, how much to say per turn before they get restless, and whether a given kind of content is better shown than spoken. Recall supplies the priors, the supervisor decides, and the ledger lets a stable pattern be promoted from heuristic to rule. This is forward vision rather than v1, but it asks for no new machinery; it is the same decision-logging the design already requires, read in the other direction.

## The single test

Every downstream decision passes or fails one check: does the supervisor stay aware of, and able to account for, everything that happens? Anything that could let an output reach an agent, or an agent act, without a corresponding event landing in the ledger violates the thesis. A design where the user takes an unexpected path but the supervisor still observes it and records it does not.
