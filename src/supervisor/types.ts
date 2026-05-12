/**
 * Supervisor public types — the interface contract between the voice front-end
 * and the durable orchestration layer.
 *
 * IMPORTANT: this file is the load-bearing surface. The voice front-end imports
 * from here (via "@/supervisor"); the implementation in process-turn.ts and
 * cancel-action.ts can change without breaking callers as long as these types
 * stay stable.
 */

import type { EventLogKind } from "@/lib/event-log-store";

export interface RephrasedResult {
  text: string;
  threadIds: string[];
  confidence: number;
}

export type RouteDecision =
  | { kind: "casual"; rephrase: RephrasedResult; ack: string }
  | { kind: "clarification_needed"; rephrase: RephrasedResult; question: string }
  | {
      kind: "action";
      rephrase: RephrasedResult;
      ack: string;
      capability: string;
      confidence: number;
      params: Record<string, unknown>;
    };

export interface Capability {
  id: string;
  description: string;
  keywords: string[];
  requiresConfirmation: boolean;
}

export interface ExecuteActionInput {
  actionId: string;
  sessionId: string;
  capability: string;
  params: Record<string, unknown>;
  rephrase: string;
  threadIds: string[];
  requiresConfirmation: boolean;
}

export const CAPABILITIES: Capability[] = [
  {
    id: "web.search",
    description: "Search the web for information.",
    keywords: ["search", "look up", "find", "google", "what is", "who is"],
    requiresConfirmation: false,
  },
  {
    id: "message.send",
    description: "Compose and send a message via Telegram.",
    keywords: ["send", "message", "tell", "notify", "ping", "let them know"],
    requiresConfirmation: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Request / Response                                                          */
/* -------------------------------------------------------------------------- */

export interface ConversationContext {
  /** Prior turns the supervisor should consider when classifying intent. */
  recentTurns?: Array<{
    role: "user" | "agent";
    text: string;
    timestamp: number;
  }>;
  /** Active thread / workspace identifier, if applicable. */
  threadId?: string;
  /** Anything else the front-end wants to forward. Free-form. */
  metadata?: Record<string, unknown>;
}

export interface SupervisorRequest {
  /** Raw transcript from the user's utterance. */
  transcript: string;
  /** Stable session identifier (one per voice session). */
  sessionId: string;
  /** Optional conversation history / metadata. */
  context?: ConversationContext;
}

export interface SupervisorResponse {
  /** Verbal acknowledgment the voice model should say while the action runs. */
  ack: string;
  /** Handle for cancellation. Pass to cancelAction() to abort an in-flight action. */
  actionId?: string;
  /** What the supervisor decided the user wants. */
  decision: RouteDecision;
}

/* -------------------------------------------------------------------------- */
/* Events + Transport                                                          */
/* -------------------------------------------------------------------------- */

export interface SupervisorEvent {
  /** Type tag used for UI rendering. Mirrors the EventLogKind types. */
  kind: SupervisorEventKind;
  label: string;
  detail?: string;
  payload?: Record<string, unknown>;
}

/**
 * Subset of EventLogKind that the supervisor itself emits (excluding voice-loop events
 * which the front-end emits separately).
 */
export type SupervisorEventKind = Extract<
  EventLogKind,
  | "rephrased"
  | "classified"
  | "clarification_needed"
  | "dispatched"
  | "awaiting"
  | "completed"
  | "failed"
  | "retried"
  | "cancelled"
  | "info"
  | "error"
>;

/**
 * Transport for streaming events out of the supervisor. The supervisor itself is
 * agnostic about destination — the caller (API route, CLI harness, unit test)
 * provides one of these and the supervisor emits through it.
 */
export interface SupervisorTransport {
  emit: (event: SupervisorEvent) => void;
}

/* -------------------------------------------------------------------------- */
/* Cancellation                                                                */
/* -------------------------------------------------------------------------- */

export interface CancelRequest {
  actionId: string;
  reason: string;
}
