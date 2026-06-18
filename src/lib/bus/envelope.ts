/**
 * The normalized envelope contract — edmini's INTERNAL event vocabulary between a transport
 * (Discord in v1; A2A / API / CLI later) and the supervisor. Transports produce and consume these;
 * the rest of edmini never sees raw harness messages.
 *
 * See docs/architecture/edmini-v1-design.md §4 ("transport vs contract").
 */

/** Harness → edmini. */
export type InboundEnvelopeKind =
  | "run_started"
  | "run_blocked" // the harness is asking the user something
  | "run_output" // a surfaceable result
  | "run_done"
  | "run_failed";

/** edmini → harness. */
export type OutboundEnvelopeKind =
  | "task_dispatch" // do this
  | "answer" // reply to a run_blocked
  | "cancel"; // stop a run

export type EnvelopeKind = InboundEnvelopeKind | OutboundEnvelopeKind;

export const INBOUND_KINDS = [
  "run_started",
  "run_blocked",
  "run_output",
  "run_done",
  "run_failed",
] as const satisfies readonly InboundEnvelopeKind[];

export const OUTBOUND_KINDS = [
  "task_dispatch",
  "answer",
  "cancel",
] as const satisfies readonly OutboundEnvelopeKind[];

/** Inbound kinds that end a run's lifecycle. */
export const TERMINAL_INBOUND_KINDS = [
  "run_done",
  "run_failed",
] as const satisfies readonly InboundEnvelopeKind[];

/** Per-kind payload shapes. */
export interface EnvelopePayloadMap {
  run_started: { note?: string };
  run_blocked: { question: string };
  run_output: { text: string };
  run_done: { summary?: string };
  run_failed: { error: string };
  task_dispatch: { instruction: string };
  answer: { text: string };
  cancel: { reason?: string };
}

export interface Envelope<K extends EnvelopeKind = EnvelopeKind> {
  kind: K;
  /** Discord thread snowflake (or transport-specific run id). */
  runId: string;
  /** Monotonic per-run sequence, for ordering. */
  seq: number;
  /** Epoch milliseconds. */
  ts: number;
  payload: EnvelopePayloadMap[K];
}

const INBOUND_SET: ReadonlySet<string> = new Set(INBOUND_KINDS);
const OUTBOUND_SET: ReadonlySet<string> = new Set(OUTBOUND_KINDS);
const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_INBOUND_KINDS);

export const isInboundKind = (k: string): k is InboundEnvelopeKind => INBOUND_SET.has(k);
export const isOutboundKind = (k: string): k is OutboundEnvelopeKind => OUTBOUND_SET.has(k);
export const isEnvelopeKind = (k: string): k is EnvelopeKind =>
  isInboundKind(k) || isOutboundKind(k);
export const isTerminalKind = (k: string): boolean => TERMINAL_SET.has(k);
