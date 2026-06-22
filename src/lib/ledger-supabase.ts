/**
 * Supabase binding for the append-only ledger. The pure, dependency-free core (types, row mapping,
 * projectRuns) lives in ./ledger.ts; this file is the thin I/O layer over @supabase/supabase-js.
 * See docs/architecture/edmini-v1-design.md §5 and infra/supabase/migrations/0001_ledger.sql.
 */
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import { fromRow, toInsert, type LedgerEvent, type LedgerRow, type LedgerSource } from "./ledger";

export interface Ledger {
  /** Append one event (DB assigns id/seq/ts). Returns the stored event. */
  append(event: LedgerEvent): Promise<LedgerEvent>;
  /** Read events ordered by seq; optionally scoped to a run or limited. */
  snapshot(opts?: {
    runId?: string;
    limit?: number;
    since?: string;
    until?: string;
    text?: string;
    source?: LedgerSource;
    author?: string;
    threadIds?: string[];
  }): Promise<LedgerEvent[]>;
  /** Subscribe to new events via Supabase Realtime. Returns the channel (call .unsubscribe()). */
  subscribe(onEvent: (event: LedgerEvent) => void): RealtimeChannel;
}

const TABLE = "events";

export function createLedger(client: SupabaseClient): Ledger {
  return {
    async append(event) {
      const { data, error } = await client.from(TABLE).insert(toInsert(event)).select().single();
      if (error) throw new Error(`ledger.append failed: ${error.message}`);
      return fromRow(data as LedgerRow);
    },

    async snapshot(opts = {}) {
      let query = client.from(TABLE).select("*").order("seq", { ascending: true });
      if (opts.runId) query = query.eq("run_id", opts.runId);
      if (opts.since) query = query.gte("ts", opts.since);
      if (opts.until) query = query.lte("ts", opts.until);
      if (opts.source) query = query.eq("source", opts.source);
      if (opts.author) query = query.eq("payload->>author", opts.author);
      if (opts.threadIds && opts.threadIds.length) query = query.in("thread_id", opts.threadIds);
      // `payload` is jsonb; ILIKE needs a text operand, so cast the column (`payload::text`). A bare
      // .ilike("payload", …) errors on jsonb in PostgREST. The route catches snapshot errors (fail-open),
      // but the cast makes the free-text filter actually work. Verify live (edmini-iee check (a)).
      if (opts.text) query = query.filter("payload::text", "ilike", `%${opts.text}%`);
      if (opts.limit != null) query = query.limit(opts.limit);
      const { data, error } = await query;
      if (error) throw new Error(`ledger.snapshot failed: ${error.message}`);
      return (data as LedgerRow[]).map(fromRow);
    },

    subscribe(onEvent) {
      const channel = client.channel("ledger:events");
      // supabase-js overloads .on('postgres_changes', …) tightly; cast to keep the call simple.
      (channel.on as (...args: unknown[]) => unknown)(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: TABLE },
        (payload: { new: LedgerRow }) => onEvent(fromRow(payload.new)),
      );
      return channel.subscribe();
    },
  };
}

/**
 * Build a Ledger from environment. Use serviceRole=true for server-side writers (worker/API,
 * bypasses RLS); the anon key is for the browser (voice app) subscribe path.
 */
export function ledgerFromEnv(opts: { serviceRole?: boolean } = {}): Ledger {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = opts.serviceRole
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is required");
  if (!key) throw new Error(`Supabase ${opts.serviceRole ? "service-role" : "anon"} key is required`);
  return createLedger(createClient(url, key, { auth: { persistSession: false } }));
}
