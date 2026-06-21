/**
 * Threads (edmini-shd) — the conversation locus (voice | written) and the first-class, bidirectional
 * map between our minted ids and a transport-native handle (api_identifier). Pure type + helpers here;
 * the thin Supabase binding mirrors ledger-supabase.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ThreadMedium = "voice" | "written";

export interface ThreadRecord {
  id: string;
  medium: ThreadMedium;
  transport: string;
  apiIdentifier: string;
  runId: string | null;
  topicId: string | null;
  createdAt?: string;
}

interface ThreadRow {
  id: string;
  medium: ThreadMedium;
  transport: string;
  api_identifier: string;
  run_id: string | null;
  topic_id: string | null;
  created_at?: string;
}

function fromRow(r: ThreadRow): ThreadRecord {
  return {
    id: r.id, medium: r.medium, transport: r.transport,
    apiIdentifier: r.api_identifier, runId: r.run_id, topicId: r.topic_id, createdAt: r.created_at,
  };
}

/**
 * Back-compat (no migration): a pre-shd run has no threads row, so its Discord snowflake IS the id and
 * the api_identifier. Resolvers fall back to this so old runs still answer/cancel/deep-link.
 */
export function legacyThreadFor(transport: string, apiIdentifier: string): ThreadRecord {
  return { id: apiIdentifier, medium: "written", transport, apiIdentifier, runId: apiIdentifier, topicId: null };
}

export interface ThreadStore {
  insert(t: Omit<ThreadRecord, "createdAt">): Promise<ThreadRecord>;
  byApiIdentifier(transport: string, apiIdentifier: string): Promise<ThreadRecord | null>;
  byRunId(runId: string): Promise<ThreadRecord | null>;
}

const TABLE = "threads";

export function createThreadStore(client: SupabaseClient): ThreadStore {
  return {
    async insert(t) {
      const row = {
        id: t.id, medium: t.medium, transport: t.transport,
        api_identifier: t.apiIdentifier, run_id: t.runId, topic_id: t.topicId,
      };
      const { data, error } = await client.from(TABLE).insert(row).select().single();
      if (error) throw new Error(`threads.insert failed: ${error.message}`);
      return fromRow(data as ThreadRow);
    },
    async byApiIdentifier(transport, apiIdentifier) {
      const { data, error } = await client.from(TABLE).select("*")
        .eq("transport", transport).eq("api_identifier", apiIdentifier).maybeSingle();
      if (error) throw new Error(`threads.byApiIdentifier failed: ${error.message}`);
      return data ? fromRow(data as ThreadRow) : null;
    },
    async byRunId(runId) {
      const { data, error } = await client.from(TABLE).select("*").eq("run_id", runId).maybeSingle();
      if (error) throw new Error(`threads.byRunId failed: ${error.message}`);
      return data ? fromRow(data as ThreadRow) : null;
    },
  };
}

export function threadStoreFromEnv(opts: { serviceRole?: boolean } = {}): ThreadStore {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = opts.serviceRole
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("SUPABASE_URL is required");
  if (!key) throw new Error(`Supabase ${opts.serviceRole ? "service-role" : "anon"} key is required`);
  return createThreadStore(createClient(url, key, { auth: { persistSession: false } }));
}
