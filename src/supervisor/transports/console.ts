/**
 * Console transport — emits supervisor events to stdout. Used by the CLI
 * test harness (`pnpm supervisor:test`) and any unit tests.
 *
 * Color-codes by event kind so the output is readable when probing the
 * supervisor in isolation.
 */
import type { SupervisorEvent, SupervisorTransport } from "../types";

const RESET = "\x1b[0m";
const COLOR: Record<string, string> = {
  rephrased: "\x1b[36m",            // cyan
  classified: "\x1b[96m",           // bright cyan
  clarification_needed: "\x1b[33m", // yellow
  dispatched: "\x1b[32m",           // green
  awaiting: "\x1b[90m",             // gray
  completed: "\x1b[92m",            // bright green
  failed: "\x1b[31m",               // red
  retried: "\x1b[93m",              // bright yellow
  cancelled: "\x1b[35m",            // magenta
  info: "\x1b[37m",                 // white
  error: "\x1b[91m",                // bright red
};

export function createConsoleTransport(): SupervisorTransport {
  const start = Date.now();
  return {
    emit(event: SupervisorEvent) {
      const color = COLOR[event.kind] ?? "";
      const elapsed = `+${(Date.now() - start).toString().padStart(5, " ")}ms`;
      const line = `${color}[${elapsed}] ${event.kind.padEnd(22)}${RESET} ${event.label}`;
      console.log(line);
      if (event.detail) {
        console.log(`         ${event.detail}`);
      }
      if (event.payload) {
        console.log(`         ${JSON.stringify(event.payload)}`);
      }
    },
  };
}
