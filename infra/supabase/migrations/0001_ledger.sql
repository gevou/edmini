-- edmini v1 — append-only accountability ledger (system of record).
-- Every boundary crossing (user / edmini / harness) is one immutable event.
-- Run lifecycle and read/unread are PROJECTIONS over this table, never stored mutable state.

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ── events: the ledger ──────────────────────────────────────────────────────
create table if not exists public.events (
  id        uuid        primary key default gen_random_uuid(),
  seq       bigint      generated always as identity,   -- total order for replay
  ts        timestamptz not null default now(),
  run_id    text,                                       -- Discord thread snowflake (nullable: pre-run/system)
  source    text        not null check (source in ('user','edmini','harness')),
  kind      text        not null,                        -- envelope kind or UI event kind
  payload   jsonb       not null default '{}'::jsonb
);

create index if not exists events_seq_idx     on public.events (seq);
create index if not exists events_run_ts_idx  on public.events (run_id, ts);
create index if not exists events_ts_idx      on public.events (ts);

-- ── append-only enforcement: block UPDATE/DELETE ────────────────────────────
create or replace function public.events_no_mutate() returns trigger
language plpgsql as $$
begin
  raise exception 'events is append-only (% not allowed)', tg_op;
end;
$$;

drop trigger if exists events_block_mutate on public.events;
create trigger events_block_mutate
  before update or delete on public.events
  for each row execute function public.events_no_mutate();

-- ── runs: projection of current lifecycle per run_id ────────────────────────
-- Lifecycle derived from the latest run_* envelope kind seen for each run.
create or replace view public.runs as
select
  e.run_id,
  (array_agg(e.kind order by e.seq desc)
     filter (where e.kind in
       ('run_started','run_blocked','run_output','run_done','run_failed')))[1]
                                                   as last_run_kind,
  min(e.ts)                                        as started_at,
  max(e.ts)                                        as last_activity,
  count(*)                                         as event_count,
  count(*) filter (where e.kind = 'run_output')    as output_count
from public.events e
where e.run_id is not null
group by e.run_id;

-- ── Realtime: let the voice app subscribe to inserts ────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
exception when undefined_object then
  -- publication doesn't exist (non-Supabase Postgres) — skip silently.
  null;
end $$;
