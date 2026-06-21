-- edmini shd — channel-agnostic identity & the thread model.
-- Identity = minted run_<uuid>/thr_<uuid> (opaque). The transport-native handle is kept as
-- api_identifier. threads is the first-class, bidirectional id<->api_identifier map.

-- ── threads: conversation loci (voice | written) ────────────────────────────
create table if not exists public.threads (
  id             text        primary key,                 -- thr_<uuid> (minted by us)
  medium         text        not null check (medium in ('voice','written')),
  transport      text        not null,                    -- 'discord' | 'openai-realtime' | ...
  api_identifier text        not null,                    -- transport-native handle (thread id / session id)
  run_id         text,                                    -- denormalized for the 1:1 executor case (null for voice)
  topic_id       text,                                    -- link to a topic (deferred; nullable)
  created_at     timestamptz not null default now()
);

-- inbound resolution: api_identifier -> thread (worker hot path)
create unique index if not exists threads_transport_apiid_idx
  on public.threads (transport, api_identifier);
-- outbound resolution: run_id -> thread (answer/cancel)
create index if not exists threads_run_id_idx on public.threads (run_id);

-- ── events gain thread_id (the conversation locus) ──────────────────────────
alter table public.events add column if not exists thread_id text;
create index if not exists events_thread_idx on public.events (thread_id);
