import type { ThreadStore } from "../src/lib/threads";
import { legacyThreadFor } from "../src/lib/threads";

export interface ResolvedRun { threadId: string; runId: string | null; }

export interface RunResolverDeps {
  store: ThreadStore;
  transport: string;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: number;
}

/**
 * Resolve a transport handle (e.g. Discord thread id) to our {threadId, runId} for ledger writes.
 * Cache hits avoid all I/O. On a miss we retry briefly (the /api/bus threads-row write may not have
 * landed yet), then fall back to legacy (the handle IS the runId for pre-shd runs).
 */
export function createRunResolver(deps: RunResolverDeps) {
  const { store, transport, retries = 3, delayMs = 300 } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const cache = new Map<string, ResolvedRun>();

  return {
    async resolve(apiIdentifier: string): Promise<ResolvedRun> {
      const cached = cache.get(apiIdentifier);
      if (cached) return cached;
      for (let attempt = 0; attempt <= retries; attempt++) {
        const thr = await store.byApiIdentifier(transport, apiIdentifier);
        if (thr) {
          const resolved = { threadId: thr.id, runId: thr.runId };
          cache.set(apiIdentifier, resolved);
          return resolved;
        }
        if (attempt < retries) await sleep(delayMs);
      }
      const legacy = legacyThreadFor(transport, apiIdentifier);
      const resolved = { threadId: legacy.id, runId: legacy.runId };
      cache.set(apiIdentifier, resolved);
      return resolved;
    },
  };
}
