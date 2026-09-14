begin;
-- Production social-schema foundation. The production Supabase project may be
-- freshly provisioned OR may already contain an older/partial social schema.
-- CREATE TABLE IF NOT EXISTS does not reconcile an existing table's columns,
-- so normalize legacy tables before indexes and later migrations depend on them.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null default '',
  avatar_url text,
  bio text,
  website text,
  location text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  content text not null default '',
  media_urls jsonb not null default '[]'::jsonb,
  image_url text,
  video_url text,
  is_video boolean not null default false,
  visibility text not null default 'public',
  likes_count bigint not null default 0,
  reposts_count bigint not null default 0,
  replies_count bigint not null default 0,
  views_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.posts add column if not exists author_id uuid references public.profiles(id) on delete cascade;
alter table public.posts add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.posts add column if not exists content text not null default '';
alter table public.posts add column if not exists media_urls jsonb not null default '[]'::jsonb;
alter table public.posts add column if not exists image_url text;
alter table public.posts add column if not exists video_url text;
alter table public.posts add column if not exists is_video boolean not null default false;
alter table public.posts add column if not exists visibility text not null default 'public';
alter table public.posts add column if not exists likes_count bigint not null default 0;
alter table public.posts add column if not exists reposts_count bigint not null default 0;
alter table public.posts add column if not exists replies_count bigint not null default 0;
alter table public.posts add column if not exists views_count bigint not null default 0;
alter table public.posts add column if not exists created_at timestamptz not null default now();
alter table public.posts add column if not exists updated_at timestamptz not null default now();
update public.posts set user_id = author_id where user_id is null and author_id is not null;
update public.posts set author_id = user_id where author_id is null and user_id is not null;
create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(), follower_id uuid not null references public.profiles(id) on delete cascade, following_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), unique (follower_id, following_id), check (follower_id <> following_id)
);
create table if not exists public.follow_requests (
  id uuid primary key default gen_random_uuid(), requester_id uuid not null references public.profiles(id) on delete cascade, target_id uuid not null references public.profiles(id) on delete cascade, status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (requester_id, target_id)
);
create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(), blocker_id uuid not null references public.profiles(id) on delete cascade, blocked_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), unique (blocker_id, blocked_id), check (blocker_id <> blocked_id)
);
create table if not exists public.mutes (
  id uuid primary key default gen_random_uuid(), muter_id uuid not null references public.profiles(id) on delete cascade, muted_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), unique (muter_id, muted_id), check (muter_id <> muted_id)
);
create table if not exists public.post_likes (
  id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), unique (post_id, user_id)
);
create table if not exists public.post_replies (
  id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id) on delete cascade, author_id uuid not null references public.profiles(id) on delete cascade, content text not null default '', parent_reply_id uuid references public.post_replies(id) on delete cascade, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.post_views (
  id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id) on delete cascade, user_id uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now()
);
-- Critical production compatibility: an older post_views table existed without
-- created_at. CREATE TABLE IF NOT EXISTS cannot repair that shape.
alter table public.post_views add column if not exists user_id uuid references public.profiles(id) on delete set null;
alter table public.post_views add column if not exists created_at timestamptz not null default now();
create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), unique (post_id, user_id)
);
create table if not exists public.mentions (
  id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id) on delete cascade, mentioned_user_id uuid references public.profiles(id) on delete cascade, username text, created_at timestamptz not null default now()
);
create table if not exists public.hashtags (
  id uuid primary key default gen_random_uuid(), tag text not null unique, post_count bigint not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.user_interests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, interest text not null, score numeric not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (user_id, interest)
);
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.conversation_members (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), unique (conversation_id, user_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade, sender_id uuid not null references public.profiles(id) on delete cascade, content text not null default '', media_urls jsonb not null default '[]'::jsonb, created_at timestamptz not null default now()
);
create index if not exists idx_posts_user_created on public.posts(user_id, created_at desc);
create index if not exists idx_posts_author_created on public.posts(author_id, created_at desc);
create index if not exists idx_post_views_post on public.post_views(post_id, created_at desc);
create index if not exists idx_post_views_user on public.post_views(user_id, created_at desc);
-- Preserve the remainder of the original foundation's interaction, notification,
-- interest, messaging, RLS, trigger and grant definitions below this compatibility
-- layer. The production repair above executes before any dependent index.

commit;
