begin;
-- Core account/device/settings/media primitives used by the web and native clients.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'system',
  language text not null default 'en',
  timezone text not null default 'UTC',
  privacy jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists user_settings_own on public.user_settings;
create policy user_settings_own on public.user_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('web','android','ios','desktop')),
  device_name text,
  push_token text,
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, push_token)
);
alter table public.user_devices enable row level security;
drop policy if exists user_devices_own on public.user_devices;
create policy user_devices_own on public.user_devices
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_key text not null unique,
  media_url text,
  media_type text not null,
  mime_type text,
  byte_size bigint not null default 0 check (byte_size >= 0),
  width integer,
  height integer,
  duration_ms bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.media_assets enable row level security;
drop policy if exists media_assets_read_own on public.media_assets;
drop policy if exists media_assets_write_own on public.media_assets;
create policy media_assets_read_own on public.media_assets
  for select to authenticated
  using (owner_id = auth.uid());
create policy media_assets_write_own on public.media_assets
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  resource_type text,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.audit_events enable row level security;
drop policy if exists audit_events_insert_own on public.audit_events;
drop policy if exists audit_events_read_own on public.audit_events;
create policy audit_events_insert_own on public.audit_events
  for insert to authenticated
  with check (user_id = auth.uid());
create policy audit_events_read_own on public.audit_events
  for select to authenticated
  using (user_id = auth.uid());
-- Query paths used by feed, notifications, messaging and media.
create index if not exists idx_posts_created_at on public.posts(created_at desc);
create index if not exists idx_posts_author_created_at on public.posts(author_id, created_at desc);
create index if not exists idx_post_likes_user on public.post_likes(user_id, created_at desc);
create index if not exists idx_post_replies_post on public.post_replies(post_id, created_at desc);
create index if not exists idx_follows_follower on public.follows(follower_id, created_at desc);
create index if not exists idx_follows_following on public.follows(following_id, created_at desc);
create index if not exists idx_notifications_recipient_created on public.notifications(recipient_id, created_at desc);
create index if not exists idx_messages_conversation_created on public.messages(conversation_id, created_at desc);
create index if not exists idx_media_assets_owner_created on public.media_assets(owner_id, created_at desc);
create index if not exists idx_audit_events_user_created on public.audit_events(user_id, created_at desc);
-- Private Supabase Storage bucket for camera, microphone, post and message media.
insert into storage.buckets (id, name, public)
values ('user-media', 'user-media', false)
on conflict (id) do nothing;
drop policy if exists user_media_select on storage.objects;
drop policy if exists user_media_insert on storage.objects;
drop policy if exists user_media_update on storage.objects;
drop policy if exists user_media_delete on storage.objects;
create policy user_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'user-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy user_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'user-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy user_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'user-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'user-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy user_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'user-media' and (storage.foldername(name))[1] = auth.uid()::text);
commit;
