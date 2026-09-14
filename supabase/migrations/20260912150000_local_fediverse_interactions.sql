-- Keep imported Fediverse content interactive inside Testagram without redirecting users to origin instances.
create table if not exists public.federated_local_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  object_uri text not null,
  interaction_type text not null check (interaction_type in ('like','repost','bookmark','reply','quote')),
  content text,
  created_at timestamptz not null default now(),
  unique (user_id, object_uri, interaction_type)
);

create index if not exists federated_local_interactions_object_idx
  on public.federated_local_interactions(object_uri, interaction_type);

create table if not exists public.federated_local_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_uri text not null,
  actor_handle text,
  created_at timestamptz not null default now(),
  unique (user_id, actor_uri)
);

create index if not exists federated_local_follows_actor_idx
  on public.federated_local_follows(actor_uri);

alter table public.federated_local_interactions enable row level security;
alter table public.federated_local_follows enable row level security;

drop policy if exists federated_local_interactions_select_own on public.federated_local_interactions;
create policy federated_local_interactions_select_own
  on public.federated_local_interactions for select using (auth.uid() = user_id);

drop policy if exists federated_local_interactions_insert_own on public.federated_local_interactions;
create policy federated_local_interactions_insert_own
  on public.federated_local_interactions for insert with check (auth.uid() = user_id);

drop policy if exists federated_local_interactions_delete_own on public.federated_local_interactions;
create policy federated_local_interactions_delete_own
  on public.federated_local_interactions for delete using (auth.uid() = user_id);

drop policy if exists federated_local_follows_select_own on public.federated_local_follows;
create policy federated_local_follows_select_own
  on public.federated_local_follows for select using (auth.uid() = user_id);

drop policy if exists federated_local_follows_insert_own on public.federated_local_follows;
create policy federated_local_follows_insert_own
  on public.federated_local_follows for insert with check (auth.uid() = user_id);

drop policy if exists federated_local_follows_delete_own on public.federated_local_follows;
create policy federated_local_follows_delete_own
  on public.federated_local_follows for delete using (auth.uid() = user_id);
