begin;

create table if not exists public.federation_actors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  username text not null unique,
  actor_url text not null unique,
  inbox_url text not null,
  public_key_pem text not null,
  private_key_jwk jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.federation_remote_actors (
  id uuid primary key default gen_random_uuid(),
  actor_url text not null unique,
  acct text,
  username text,
  domain text,
  inbox_url text,
  shared_inbox_url text,
  actor jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.federation_objects (
  id uuid primary key default gen_random_uuid(),
  object_url text not null unique,
  actor_url text,
  object_type text,
  object jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.federation_relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  remote_actor_url text not null,
  relationship text not null check (relationship in ('pending','accepted','following','rejected','unfollow_pending','unfollowed','failed')),
  activity_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, remote_actor_url)
);

create table if not exists public.federation_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  activity_id text not null unique,
  activity_type text not null,
  actor_url text not null,
  inbox_url text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivered','failed','dead_letter')),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  http_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.federation_inbox (
  id uuid primary key default gen_random_uuid(),
  activity_id text not null unique,
  activity_type text not null,
  actor_url text,
  payload jsonb not null,
  processing_status text not null default 'processed' check (processing_status in ('received','processed','rejected','failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists federation_objects_actor_idx on public.federation_objects(actor_url, published_at desc);
create index if not exists federation_objects_published_idx on public.federation_objects(published_at desc);
create index if not exists federation_relationships_user_idx on public.federation_relationships(user_id, updated_at desc);
create index if not exists federation_outbox_retry_idx on public.federation_outbox(status, next_attempt_at);
create index if not exists federation_inbox_received_idx on public.federation_inbox(received_at desc);

alter table public.federation_actors enable row level security;
alter table public.federation_remote_actors enable row level security;
alter table public.federation_objects enable row level security;
alter table public.federation_relationships enable row level security;
alter table public.federation_outbox enable row level security;
alter table public.federation_inbox enable row level security;

-- Federation secrets and delivery state are service-role managed. No client policies are intentionally exposed.

commit;
