/**
 * Supervisor public API.
 *
 * This is the only file consumers (the voice front-end, the API route, the
 * CLI test harness) should import from. Internal modules (process-turn.ts,
 * cancel-action.ts, transports/*) can change shape without breaking callers
 * as long as the exports below stay stable.
 *
 * @see ./README.md for the contract.
 */

export { processTurn } from "./process-turn";
export { cancelAction } from "./cancel-action";
export { createConsoleTransport } from "./transports/console";
export { createServerStoreTransport } from "./transports/server-store";
export {
  createSseTransport,
  writeSseResult,
  writeSseError,
  type SseEnvelope,
} from "./transports/sse";
export type {
  ConversationContext,
  SupervisorRequest,
  SupervisorResponse,
  SupervisorEvent,
  SupervisorEventKind,
  SupervisorTransport,
  RouteDecision,
  RephrasedResult,
  CancelRequest,
} from "./types";
