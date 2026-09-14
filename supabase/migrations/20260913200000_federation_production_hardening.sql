-- Federation production hardening: remote actor freshness and per-instance delivery health.
-- Additive/idempotent. Existing federation data and identity URLs are preserved.

alter table public.federated_actors
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_fetch_success_at timestamptz,
  add column if not exists last_fetch_failure_at timestamptz,
  add column if not exists next_refresh_at timestamptz,
  add column if not exists refresh_failure_count integer not null default 0,
  add column if not exists etag text,
  add column if not exists last_modified text,
  add column if not exists federation_status text not null default 'active';

update public.federated_actors
set first_seen_at = coalesce(first_seen_at, fetched_at, updated_at, now()),
    last_fetch_success_at = coalesce(last_fetch_success_at, fetched_at, updated_at),
    next_refresh_at = coalesce(next_refresh_at, now() + interval '6 hours')
where first_seen_at is null
   or last_fetch_success_at is null
   or next_refresh_at is null;

create index if not exists federated_actors_refresh_idx
  on public.federated_actors (next_refresh_at)
  where federation_status = 'active';

create table if not exists public.federation_instance_health (
  domain text primary key,
  consecutive_failures integer not null default 0,
  consecutive_successes integer not null default 0,
  circuit_state text not null default 'closed',
  opened_at timestamptz,
  next_probe_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_status_code integer,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint federation_instance_health_state_ck
    check (circuit_state in ('closed','open','half_open'))
);

create index if not exists federation_instance_health_probe_idx
  on public.federation_instance_health (next_probe_at)
  where circuit_state <> 'closed';

alter table public.federation_instance_health enable row level security;
revoke all on public.federation_instance_health from anon, authenticated;
