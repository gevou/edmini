# Supervisor

Conversation-flow orchestration layer for edmini's voice loop.

## What this is

A typed module that sits behind `/api/intent/classify` and decides what to do
when the OpenAI Realtime model fires a `classify_and_route` tool call. It does
not own the voice loop itself — that stays in the WebRTC + Realtime layer
(see `src/components/VoiceAgent.tsx`).

The module is currently a **noop**: every entry point emits a believable event
sequence through the provided transport and returns a fake response. The real
implementation will replace each step with an LLM call (rephrase, classify,
route) wrapped in a Workflow SDK `'use workflow'` for durability.

## Public API

Import from `@/supervisor` only. Internal modules can change without notice.

```ts
import {
  processTurn,
  cancelAction,
  createConsoleTransport,
  createServerStoreTransport,
  type SupervisorRequest,
  type SupervisorResponse,
  type SupervisorEvent,
  type SupervisorTransport,
} from "@/supervisor";

// In an API route handler — events flow into the server event log, not back
// on the response. The route returns a plain JSON SupervisorResponse.
const transport: SupervisorTransport = createServerStoreTransport();
const result = await processTurn(request, transport);
return Response.json(result);
```

### `processTurn(request, transport): Promise<SupervisorResponse>`

Runs the full intent pipeline for one user utterance. Emits events through
the transport as it goes (rephrased → classified → dispatched → completed).
Returns the verbal acknowledgment for the voice model and a handle for
cancellation.

### `cancelAction(request, transport): Promise<void>`

Aborts an in-flight action by `actionId`. Currently a noop that emits a
`cancelled` event. Real implementation will call the Workflow SDK's
cancellation primitive.

## Transports

The supervisor doesn't know or care where its events go. Pick a transport
based on context:

- **`createServerStoreTransport()`** — writes events into the server-side
  event log (`src/lib/server-event-log.ts`). This is the **production path**
  used by `/api/intent/classify`. Events fan out to every subscribed UI
  through `/api/events/stream` (SSE).
- **`createConsoleTransport()`** — colorized stdout. Used by the CLI harness
  and unit tests.
- **`createSseTransport(controller, encoder)`** — wraps a `ReadableStream`
  controller for response-stream-style SSE. **No longer used in production**
  (the route returns plain JSON now), but kept for future use cases like a
  tee transport that also returns events on the response.

You can implement custom transports easily — see the `SupervisorTransport`
interface in `types.ts`.

## CLI harness

```bash
# Run the noop pipeline end-to-end
pnpm supervisor:test "schedule team standup for tuesday"

# Probe the cancellation path
pnpm supervisor:test "wait change that" --cancel act_noop_1_1234567
```

Output is colorized event lines plus the final `SupervisorResponse`. Useful
for probing the workflow primitives without spinning up the voice front-end.

## Wiring (for reference)

```
voice agent ──POST──▶ /api/intent/classify ──▶ supervisor.processTurn
                              │                          │
                              │ JSON ack back            │ transport.emit
                              ▼                          ▼
                       (tool result)            server-side event store
                                                          │
                                                  subscribers ▼
                                  ┌──────────────────────────────────┐
                                  │  /api/events/stream  (SSE)       │
                                  └──────────────────────────────────┘
                                              ▲                ▲
                                              │                │
                                          dashboard       voice agent UI
                                          (subscribes)    (subscribes)
```

- **Realtime tool config** — `src/app/api/session/route.ts` declares the
  `classify_and_route` and `cancel_pending_action` tools that the voice model
  calls.
- **Classify route** — `src/app/api/intent/classify/route.ts` runs
  `processTurn` with a `createServerStoreTransport()` and returns the
  `SupervisorResponse` as plain JSON. Supervisor events are emitted into the
  server event log, not back on the response.
- **Event endpoints** — `src/app/api/events/stream/route.ts` is the SSE
  fan-out (snapshot + live events); `src/app/api/events/push/route.ts` is
  the write path used by client-side voice-loop events (`user_spoke`,
  `model_speaking`, …).
- **Client store** — `src/lib/event-log-store.ts` is a *mirror* of the
  server log. `pushEvent` POSTs through the server; `useEventLog`
  lazily opens an `EventSource` on first mount and updates the local
  mirror on each `event`/`snapshot`/`cleared` envelope.
- **Voice agent** — `src/components/VoiceAgent.tsx` parses
  `response.function_call_arguments.done` events from the data channel,
  POSTs to `/api/intent/classify`, awaits the JSON response, and sends the
  `ack` back to the Realtime model via `conversation.item.create` +
  `response.create`. Events arrive via SSE alongside the dashboard's.

## Roadmap

1. **Phase 1 (now)** — noop end-to-end, harness verified.
2. **Phase 2** — replace `processTurn` body with real LLM calls
   (rephrase / classify / route).
3. **Phase 3** — wrap each step in a Workflow SDK `'use step'` directive,
   wrap the whole function in `'use workflow'`. This is the load-bearing
   portion of the Pranay take-home.
4. **Phase 4** — hunt one rough edge: cancellation semantics, determinism
   violations, or step result size limits. Document findings in the writeup.
