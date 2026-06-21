/**
 * Minted, opaque, prefixed identities we own (edmini-shd). Prefixes make ids self-describing in
 * logs and the ledger. Channel-agnostic: a runId/threadId never encodes a transport.
 */
export const RUN_PREFIX = "run_";
export const THREAD_PREFIX = "thr_";

function uuid(): string {
  return crypto.randomUUID();
}

export function mintRunId(): string {
  return `${RUN_PREFIX}${uuid()}`;
}

export function mintThreadId(): string {
  return `${THREAD_PREFIX}${uuid()}`;
}
