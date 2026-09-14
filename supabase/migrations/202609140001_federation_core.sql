-- Native Testagram ActivityPub protocol state.
-- Product data stays in the existing schema; federation state is isolated here.
create table if not exists public.federation_actors (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id) on delete cascade,
  username text not null unique, display_name text, bio text, avatar_url text, header_url text,
  actor_uri text not null unique, inbox_uri text not null unique, outbox_uri text not null unique,
  followers_uri text not null unique, following_uri text not null unique, public_key_pem text not null,
  enabled boolean not null default true, discoverable boolean not null default true, locked boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.federation_actor_keys (
  actor_id uuid primary key references public.federation_actors(id) on delete cascade,
  private_key_pem text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.federation_objects (
  id uuid primary key default gen_random_uuid(), object_uri text not null unique, activity_uri text unique,
  actor_uri text not null, object_type text not null, local boolean not null default true, local_post_id text,
  payload jsonb not null default '{}'::jsonb, published_at timestamptz, updated_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists federation_objects_actor_idx on public.federation_objects(actor_uri, published_at desc);
create index if not exists federation_objects_local_post_idx on public.federation_objects(local_post_id);
create table if not exists public.federation_followers (
  id uuid primary key default gen_random_uuid(), local_actor_id uuid not null references public.federation_actors(id) on delete cascade,
  remote_actor_uri text not null, remote_inbox_uri text not null, remote_shared_inbox_uri text,
  state text not null default 'pending' check (state in ('pending','accepted','rejected','removed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(local_actor_id, remote_actor_uri)
);
create table if not exists public.federation_deliveries (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.federation_actors(id) on delete cascade,
  activity_uri text not null, target_inbox text not null, payload jsonb not null,
  state text not null default 'queued' check (state in ('queued','delivering','delivered','retry','dead')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(), last_status integer,
  last_error text, delivered_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists federation_deliveries_queue_idx on public.federation_deliveries(state, next_attempt_at);
create table if not exists public.federation_inbox (
  id uuid primary key default gen_random_uuid(), local_actor_id uuid references public.federation_actors(id) on delete cascade,
  activity_uri text unique, actor_uri text, activity_type text, payload jsonb not null,
  signature_valid boolean not null default false, processed boolean not null default false, error text,
  received_at timestamptz not null default now(), processed_at timestamptz
);
create index if not exists federation_inbox_unprocessed_idx on public.federation_inbox(processed, received_at);
alter table public.federation_actors enable row level security;
alter table public.federation_actor_keys enable row level security;
alter table public.federation_objects enable row level security;
alter table public.federation_followers enable row level security;
alter table public.federation_deliveries enable row level security;
alter table public.federation_inbox enable row level security;
create policy federation_actors_public_read on public.federation_actors for select to anon, authenticated using (enabled = true);
create policy federation_actors_owner_insert on public.federation_actors for insert to authenticated with check ((select auth.uid()) = user_id);
create policy federation_actors_owner_update on public.federation_actors for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy federation_objects_public_read on public.federation_objects for select to anon, authenticated using (local = true);
create policy federation_followers_owner_read on public.federation_followers for select to authenticated using (local_actor_id in (select id from public.federation_actors where user_id = (select auth.uid())));
revoke all on public.federation_actor_keys from anon, authenticated;
revoke all on public.federation_deliveries from anon, authenticated;
revoke all on public.federation_inbox from anon, authenticated;
grant select on public.federation_actors to anon, authenticated;
grant insert, update on public.federation_actors to authenticated;
grant select on public.federation_objects to anon, authenticated;
grant select on public.federation_followers to authenticated;
create or replace function public.federation_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists federation_actors_touch on public.federation_actors;
create trigger federation_actors_touch before update on public.federation_actors for each row execute function public.federation_touch_updated_at();
drop trigger if exists federation_actor_keys_touch on public.federation_actor_keys;
create trigger federation_actor_keys_touch before update on public.federation_actor_keys for each row execute function public.federation_touch_updated_at();
