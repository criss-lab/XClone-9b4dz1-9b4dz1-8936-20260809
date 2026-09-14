create table if not exists public.federation_remote_interactions (
  id uuid primary key default gen_random_uuid(), local_user_id uuid not null references auth.users(id) on delete cascade,
  object_url text not null, remote_actor_url text, interaction_type text not null check (interaction_type in ('like','repost','reply','quote','bookmark')),
  activity_uri text, target_inbox text, status text not null default 'pending' check (status in ('pending','sent','failed','undone','local_only')),
  payload jsonb not null default '{}'::jsonb, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), expires_at timestamptz
);
create index if not exists idx_fed_remote_interactions_user_object on public.federation_remote_interactions(local_user_id,object_url,interaction_type);
create index if not exists idx_fed_remote_interactions_status on public.federation_remote_interactions(status,updated_at);
create unique index if not exists uq_fed_remote_interaction_active on public.federation_remote_interactions(local_user_id,object_url,interaction_type) where interaction_type in ('like','repost','bookmark') and status <> 'undone';
