alter table public.federated_actors add column if not exists private_key_jwk jsonb;
alter table public.federated_actors add column if not exists username text;
alter table public.federated_actors add column if not exists actor_url text;
alter table public.federated_actors add column if not exists user_id uuid references public.profiles(id) on delete cascade;
update public.federated_actors set username=coalesce(username,preferred_username), actor_url=coalesce(actor_url,uri) where username is null or actor_url is null;
create unique index if not exists federated_actors_actor_url_uidx on public.federated_actors(actor_url) where actor_url is not null;
create unique index if not exists federated_actors_user_uidx on public.federated_actors(user_id) where user_id is not null;

create table if not exists public.federation_replays (
  id uuid primary key default gen_random_uuid(),
  activity_uri text not null unique,
  actor_uri text not null,
  signature_key_id text,
  received_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists federation_replays_expiry_idx on public.federation_replays(expires_at);

create table if not exists public.federated_interactions (
  id uuid primary key default gen_random_uuid(),
  activity_uri text not null unique,
  activity_type text not null check(activity_type in ('Like','Announce')),
  actor_uri text not null,
  object_uri text not null,
  active boolean not null default true,
  raw_activity jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists federated_interactions_object_idx on public.federated_interactions(object_uri,activity_type,active);

alter table public.federated_objects add column if not exists deleted_at timestamptz;
alter table public.federated_objects add column if not exists tombstone boolean not null default false;

alter table public.federated_activities add column if not exists processing_attempts integer not null default 0;

alter table public.federation_deliveries add column if not exists activity_payload jsonb;
create index if not exists federation_deliveries_due_idx on public.federation_deliveries(status,next_attempt_at);

alter table public.federation_replays enable row level security;
alter table public.federated_interactions enable row level security;
create policy federation_replays_service_only on public.federation_replays for all to service_role using(true) with check(true);
create policy federated_interactions_read on public.federated_interactions for select to authenticated using(true);
