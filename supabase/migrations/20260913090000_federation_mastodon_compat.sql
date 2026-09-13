-- Mastodon-class ActivityPub interoperability state.
-- Keep protocol state separate from presentation tables so inbound activities are
-- durable, idempotent, auditable and reversible.

create table if not exists public.federation_reports (
  id uuid primary key default gen_random_uuid(),
  activity_uri text not null unique,
  reporter_actor_uri text not null,
  target_actor_uri text,
  target_object_uris jsonb not null default '[]'::jsonb,
  content text,
  raw_activity jsonb not null default '{}'::jsonb,
  status text not null default 'received' check (status in ('received','reviewed','resolved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists federation_reports_target_idx on public.federation_reports(target_actor_uri,status,created_at desc);

create table if not exists public.federation_quote_authorizations (
  id uuid primary key default gen_random_uuid(),
  request_uri text unique,
  authorization_uri text unique,
  quote_uri text not null,
  quoted_object_uri text not null,
  requester_actor_uri text not null,
  quoted_actor_uri text not null,
  state text not null default 'pending' check (state in ('pending','accepted','rejected','revoked')),
  raw_request jsonb,
  raw_authorization jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists federation_quote_auth_quote_idx on public.federation_quote_authorizations(quoted_object_uri,state);

create table if not exists public.federation_poll_votes (
  id uuid primary key default gen_random_uuid(),
  activity_uri text not null unique,
  actor_uri text not null,
  object_uri text not null,
  choice integer,
  raw_activity jsonb not null default '{}'::jsonb,
  state text not null default 'active' check (state in ('active','undone')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists federation_poll_votes_object_idx on public.federation_poll_votes(object_uri,actor_uri,state);

alter table public.federated_actors add column if not exists moved_to_uri text;
alter table public.federated_actors add column if not exists also_known_as jsonb not null default '[]'::jsonb;
alter table public.federated_actors add column if not exists featured_url text;
alter table public.federated_objects add column if not exists poll jsonb;
alter table public.federated_objects add column if not exists content_warning text;

alter table public.federation_reports enable row level security;
alter table public.federation_quote_authorizations enable row level security;
alter table public.federation_poll_votes enable row level security;

create policy federation_reports_service_read on public.federation_reports for select to service_role using (true);
create policy federation_quote_auth_service_read on public.federation_quote_authorizations for select to service_role using (true);
create policy federation_poll_votes_service_read on public.federation_poll_votes for select to service_role using (true);
