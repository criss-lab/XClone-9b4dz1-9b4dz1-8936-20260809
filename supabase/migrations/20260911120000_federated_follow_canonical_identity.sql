-- Canonical Fediverse follow identity hardening.
-- This table is the authoritative follow relationship store. The identity is
-- the canonical ActivityPub actor URL, never a handle or display username.
create table if not exists public.federated_follow_relationships (
  id uuid primary key default gen_random_uuid(),
  local_user_id uuid not null references public.profiles(id) on delete cascade,
  remote_actor_uri text not null,
  state text not null default 'pending' check (state in ('pending', 'accepted', 'rejected', 'removed')),
  follow_activity_uri text,
  undo_activity_uri text,
  accept_activity_uri text,
  remote_inbox_uri text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint federated_follow_relationships_actor_https check (remote_actor_uri ~ '^https://[^[:space:]]+$'),
  constraint federated_follow_relationships_unique_actor unique (local_user_id, remote_actor_uri)
);

create index if not exists federated_follow_relationships_user_state_idx
  on public.federated_follow_relationships(local_user_id, state, updated_at desc);
create index if not exists federated_follow_relationships_actor_idx
  on public.federated_follow_relationships(remote_actor_uri);

alter table public.federated_follow_relationships enable row level security;

drop policy if exists federated_follow_relationships_owner_read on public.federated_follow_relationships;
create policy federated_follow_relationships_owner_read
  on public.federated_follow_relationships
  for select to authenticated
  using (local_user_id = auth.uid());

-- Do not retrofit the legacy federated_relationships table with a stricter
-- uniqueness constraint: it contains non-follow relationship types and may
-- contain historical handle-based rows. New follow code must use the table
-- above exclusively, keyed by (local_user_id, remote_actor_uri).
