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

export interface ClassifiedIntent {
  /** Intent type string, e.g. "schedule_event" / "send_message" / "noop". */
  type: string;
  /** Confidence in [0, 1]. */
  confidence: number;
  /** Structured parameters extracted from the utterance. */
  params: Record<string, unknown>;
}

export interface SupervisorResponse {
  /** Verbal acknowledgment the voice model should say while the action runs. */
  ack: string;
  /** Handle for cancellation. Pass to cancelAction() to abort an in-flight action. */
  actionId?: string;
  /** What the supervisor decided the user wants. */
  intent: ClassifiedIntent;
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
