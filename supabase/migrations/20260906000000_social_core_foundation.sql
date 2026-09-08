begin;

-- Production social-schema foundation. The production Supabase project may be
-- freshly provisioned, so dependent migrations must not assume the application
-- tables already exist.

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

create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.follow_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_id, target_id)
);

create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.mutes (
  id uuid primary key default gen_random_uuid(),
  muter_id uuid not null references public.profiles(id) on delete cascade,
  muted_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (muter_id, muted_id),
  check (muter_id <> muted_id)
);

create table if not exists public.post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create table if not exists public.post_replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  parent_reply_id uuid references public.post_replies(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.post_views (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create table if not exists public.mentions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  mentioned_user_id uuid references public.profiles(id) on delete cascade,
  username text,
  created_at timestamptz not null default now()
);

create table if not exists public.hashtags (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique,
  post_count bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.user_interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  interest text not null,
  score numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, interest)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  media_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  post_id uuid references public.posts(id) on delete cascade,
  read boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Lightweight profile provisioning trigger. The later auth-profile migration
-- replaces this function with the full username/metadata synchronization logic.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
begin
  base_username := lower(regexp_replace(coalesce(nullif(new.raw_user_meta_data ->> 'username',''), nullif(split_part(coalesce(new.email,''),'@',1),''), 'user'), '[^a-z0-9_]+', '_', 'g'));
  base_username := regexp_replace(base_username, '^_+|_+$', '', 'g');
  if char_length(base_username) < 3 then base_username := 'user'; end if;
  base_username := left(base_username, 24);
  if exists (select 1 from public.profiles where username = base_username and id <> new.id) then
    base_username := left(base_username, 15) || '_' || substr(replace(new.id::text,'-',''),1,8);
  end if;
  insert into public.profiles (id, username, display_name, avatar_url)
  values (new.id, base_username, coalesce(nullif(new.raw_user_meta_data ->> 'full_name',''), nullif(new.raw_user_meta_data ->> 'name',''), ''), nullif(new.raw_user_meta_data ->> 'avatar_url',''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.follows enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_replies enable row level security;
alter table public.bookmarks enable row level security;
alter table public.mentions enable row level security;
alter table public.hashtags enable row level security;
alter table public.user_interests enable row level security;
alter table public.notifications enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create index if not exists idx_posts_author_created on public.posts(author_id, created_at desc);
create index if not exists idx_posts_user_created on public.posts(user_id, created_at desc);
create index if not exists idx_follows_follower on public.follows(follower_id, created_at desc);
create index if not exists idx_follows_following on public.follows(following_id, created_at desc);
create index if not exists idx_post_likes_post on public.post_likes(post_id, created_at desc);
create index if not exists idx_post_likes_user on public.post_likes(user_id, created_at desc);
create index if not exists idx_post_replies_post on public.post_replies(post_id, created_at desc);
create index if not exists idx_post_views_post on public.post_views(post_id, created_at desc);
create index if not exists idx_bookmarks_user on public.bookmarks(user_id, created_at desc);
create index if not exists idx_mentions_post on public.mentions(post_id, created_at desc);
create index if not exists idx_user_interests_user on public.user_interests(user_id, updated_at desc);
create index if not exists idx_notifications_recipient_created on public.notifications(recipient_id, created_at desc);
create index if not exists idx_messages_conversation_created on public.messages(conversation_id, created_at desc);

-- Grants are intentionally minimal; subsequent security migrations tighten the
-- policies and grants for production.
grant select on public.profiles, public.posts, public.follows, public.post_likes, public.post_replies, public.hashtags to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.posts, public.follows, public.post_likes, public.post_replies, public.bookmarks, public.mentions, public.user_interests, public.notifications, public.conversations, public.conversation_members, public.messages to authenticated;
grant execute on function public.handle_new_user() to service_role;

commit;
