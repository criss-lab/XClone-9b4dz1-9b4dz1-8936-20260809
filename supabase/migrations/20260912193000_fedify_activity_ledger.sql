-- Fedify protocol ledger: idempotent inbound activity storage and remote interaction events.
-- Additive only; preserves existing federation tables and gateway behavior.
create table if not exists public.federation_inbox_activities (
  id uuid primary key default gen_random_uuid(),
  activity_id text not null unique,
  activity_type text not null,
  actor_url text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists federation_inbox_activities_actor_idx
  on public.federation_inbox_activities(actor_url);
create index if not exists federation_inbox_activities_type_idx
  on public.federation_inbox_activities(activity_type);

create table if not exists public.federation_remote_activities (
  id uuid primary key default gen_random_uuid(),
  activity_id text not null unique,
  activity_type text not null,
  actor_url text,
  target_url text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists federation_remote_activities_actor_idx
  on public.federation_remote_activities(actor_url);
create index if not exists federation_remote_activities_target_idx
  on public.federation_remote_activities(target_url);

alter table public.federation_inbox_activities enable row level security;
alter table public.federation_remote_activities enable row level security;

revoke all on public.federation_inbox_activities from anon, authenticated;
revoke all on public.federation_remote_activities from anon, authenticated;
