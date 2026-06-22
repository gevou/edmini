/**
 * Supabase binding for the append-only ledger. The pure, dependency-free core (types, row mapping,
 * projectRuns) lives in ./ledger.ts; this file is the thin I/O layer over @supabase/supabase-js.
 * See docs/architecture/edmini-v1-design.md §5 and infra/supabase/migrations/0001_ledger.sql.
 */
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import { fromRow, toInsert, type LedgerEvent, type LedgerRow, type LedgerSource } from "./ledger";

/** Payload keys that carry user-visible text (jsonb has no ILIKE, so we search these extracted keys). */
export const TEXT_KEYS = ["text", "summary", "question", "error", "instruction", "label"] as const;

const TEXT_STOPWORDS = new Set([
  "what", "when", "where", "which", "that", "this", "with", "from", "about", "there",
  "they", "them", "were", "will", "would", "could", "should", "have", "your", "into",
  "earlier", "mentioned", "remember", "again", "recently", "just",
]);

/**
 * Build a PostgREST `or()` filter string for free-text recall over jsonb payload text (edmini-iee).
 * Tokenizes the query into content words (≥4 chars, minus stopwords) and ORs each as an ILIKE substring
 * across TEXT_KEYS — so a multi-word query ("code name") matches a compound stored word ("codename"),
 * which a whole-phrase substring (and even Postgres FTS) would miss. Metachars `,()` are stripped (they
 * break the or()-grammar). Returns null when there's nothing searchable. Falls back to the whole phrase
 * when no content words survive (e.g. a short query like "hi").
 */
export function tokenizeQuery(text: string): string[] {
  const cleaned = text.replace(/[,()]/g, " ").trim();
  if (!cleaned) return [];
  const words = cleaned.toLowerCase().split(/\s+/).filter((w) => w.length >= 4 && !TEXT_STOPWORDS.has(w));
  return words.length ? words : [cleaned.toLowerCase()]; // fall back to the whole phrase for short queries
}

export function buildTextOrFilter(text: string, keys: readonly string[] = TEXT_KEYS): string | null {
  const terms = tokenizeQuery(text);
  if (!terms.length) return null;
  return terms.flatMap((w) => keys.map((k) => `payload->>${k}.ilike.%${w}%`)).join(",");
}

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
      // When a limit is set, take the most RECENT N (order desc + limit, then reverse to chronological).
      // A bare ascending+limit returns the OLDEST N — wrong for every consumer here (recent-history
      // injection and search_history recall both want recent context). No limit → full set, ascending.
      const recentN = opts.limit != null;
      let query = client.from(TABLE).select("*").order("seq", { ascending: !recentN });
      if (opts.runId) query = query.eq("run_id", opts.runId);
      if (opts.since) query = query.gte("ts", opts.since);
      if (opts.until) query = query.lte("ts", opts.until);
      if (opts.source) query = query.eq("source", opts.source);
      if (opts.author) query = query.eq("payload->>author", opts.author);
      if (opts.threadIds && opts.threadIds.length) query = query.in("thread_id", opts.threadIds);
      // Free-text recall over `payload` (jsonb). jsonb has no ILIKE (42883) and PostgREST can't cast in a
      // filter, so we tokenize and ILIKE the extracted text keys, OR'd (see buildTextOrFilter — a word
      // query must match a compound stored word, e.g. "code name" → "codename").
      if (opts.text) {
        const orFilter = buildTextOrFilter(opts.text);
        if (orFilter) query = query.or(orFilter);
      }
      if (opts.limit != null) query = query.limit(opts.limit);
      const { data, error } = await query;
      if (error) throw new Error(`ledger.snapshot failed: ${error.message}`);
      const rows = (data as LedgerRow[]).map(fromRow);
      return recentN ? rows.reverse() : rows; // most-recent-N, returned oldest→newest
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
