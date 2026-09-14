create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  content text not null check (char_length(trim(content)) between 1 and 10000),
  cover_image text,
  media_url text,
  media_type text,
  media_urls jsonb not null default '[]'::jsonb,
  chapters jsonb,
  views_count bigint not null default 0 check (views_count >= 0),
  likes_count bigint not null default 0 check (likes_count >= 0),
  reposts_count bigint not null default 0 check (reposts_count >= 0),
  replies_count bigint not null default 0 check (replies_count >= 0),
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists threads_published_created_idx on public.threads(is_published, created_at desc);
create index if not exists threads_user_created_idx on public.threads(user_id, created_at desc);
create table if not exists public.thread_likes (id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.threads(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), unique(thread_id,user_id));
create index if not exists thread_likes_user_idx on public.thread_likes(user_id,created_at desc);
create index if not exists thread_likes_thread_idx on public.thread_likes(thread_id);
create table if not exists public.thread_reposts (id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.threads(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), unique(thread_id,user_id));
create index if not exists thread_reposts_user_idx on public.thread_reposts(user_id,created_at desc);
create index if not exists thread_reposts_thread_idx on public.thread_reposts(thread_id);
create table if not exists public.thread_bookmarks (id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.threads(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), unique(thread_id,user_id));
create index if not exists thread_bookmarks_user_idx on public.thread_bookmarks(user_id,created_at desc);
create index if not exists thread_bookmarks_thread_idx on public.thread_bookmarks(thread_id);
create table if not exists public.thread_reactions (id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.threads(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, emoji text not null check (emoji in ('❤️','😂','🔥','😮','👏')), created_at timestamptz not null default now(), unique(thread_id,user_id));
create index if not exists thread_reactions_thread_idx on public.thread_reactions(thread_id);
create table if not exists public.thread_replies (id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.threads(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, parent_reply_id uuid references public.thread_replies(id) on delete cascade, content text not null check (char_length(trim(content)) between 1 and 10000), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists thread_replies_thread_created_idx on public.thread_replies(thread_id,created_at);
create index if not exists thread_replies_parent_idx on public.thread_replies(parent_reply_id);
create index if not exists thread_replies_user_idx on public.thread_replies(user_id,created_at desc);
create or replace function public.user_profiles(public.threads) returns setof public.user_profiles rows 1 stable security invoker language sql as $$ select up.* from public.user_profiles up where up.id=$1.user_id; $$;
create or replace function public.user_profiles(public.thread_replies) returns setof public.user_profiles rows 1 stable security invoker language sql as $$ select up.* from public.user_profiles up where up.id=$1.user_id; $$;
alter table public.threads enable row level security;
alter table public.thread_likes enable row level security;
alter table public.thread_reposts enable row level security;
alter table public.thread_bookmarks enable row level security;
alter table public.thread_reactions enable row level security;
alter table public.thread_replies enable row level security;
drop policy if exists threads_public_read on public.threads;
drop policy if exists threads_authenticated_insert on public.threads;
drop policy if exists threads_owner_update on public.threads;
drop policy if exists threads_owner_delete on public.threads;
create policy threads_public_read on public.threads for select to anon,authenticated using (is_published=true);
create policy threads_authenticated_insert on public.threads for insert to authenticated with check (user_id=auth.uid());
create policy threads_owner_update on public.threads for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy threads_owner_delete on public.threads for delete to authenticated using (user_id=auth.uid());
drop policy if exists thread_likes_authenticated_read on public.thread_likes;
drop policy if exists thread_likes_authenticated_insert on public.thread_likes;
drop policy if exists thread_likes_authenticated_delete on public.thread_likes;
create policy thread_likes_authenticated_read on public.thread_likes for select to authenticated using (true);
create policy thread_likes_authenticated_insert on public.thread_likes for insert to authenticated with check (user_id=auth.uid());
create policy thread_likes_authenticated_delete on public.thread_likes for delete to authenticated using (user_id=auth.uid());
drop policy if exists thread_reposts_authenticated_read on public.thread_reposts;
drop policy if exists thread_reposts_authenticated_insert on public.thread_reposts;
drop policy if exists thread_reposts_authenticated_delete on public.thread_reposts;
create policy thread_reposts_authenticated_read on public.thread_reposts for select to authenticated using (true);
create policy thread_reposts_authenticated_insert on public.thread_reposts for insert to authenticated with check (user_id=auth.uid());
create policy thread_reposts_authenticated_delete on public.thread_reposts for delete to authenticated using (user_id=auth.uid());
drop policy if exists thread_bookmarks_authenticated_read on public.thread_bookmarks;
drop policy if exists thread_bookmarks_authenticated_insert on public.thread_bookmarks;
drop policy if exists thread_bookmarks_authenticated_delete on public.thread_bookmarks;
create policy thread_bookmarks_authenticated_read on public.thread_bookmarks for select to authenticated using (user_id=auth.uid());
create policy thread_bookmarks_authenticated_insert on public.thread_bookmarks for insert to authenticated with check (user_id=auth.uid());
create policy thread_bookmarks_authenticated_delete on public.thread_bookmarks for delete to authenticated using (user_id=auth.uid());
drop policy if exists thread_reactions_authenticated_read on public.thread_reactions;
drop policy if exists thread_reactions_authenticated_insert on public.thread_reactions;
drop policy if exists thread_reactions_authenticated_delete on public.thread_reactions;
create policy thread_reactions_authenticated_read on public.thread_reactions for select to authenticated using (true);
create policy thread_reactions_authenticated_insert on public.thread_reactions for insert to authenticated with check (user_id=auth.uid());
create policy thread_reactions_authenticated_delete on public.thread_reactions for delete to authenticated using (user_id=auth.uid());
drop policy if exists thread_replies_public_read on public.thread_replies;
drop policy if exists thread_replies_authenticated_insert on public.thread_replies;
drop policy if exists thread_replies_owner_update on public.thread_replies;
drop policy if exists thread_replies_owner_delete on public.thread_replies;
create policy thread_replies_public_read on public.thread_replies for select to anon,authenticated using (true);
create policy thread_replies_authenticated_insert on public.thread_replies for insert to authenticated with check (user_id=auth.uid());
create policy thread_replies_owner_update on public.thread_replies for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy thread_replies_owner_delete on public.thread_replies for delete to authenticated using (user_id=auth.uid());
create or replace function public.bump_thread_like_count() returns trigger language plpgsql security definer set search_path=public as $$ begin if tg_op='INSERT' then update public.threads set likes_count=likes_count+1,updated_at=now() where id=new.thread_id; return new; elsif tg_op='DELETE' then update public.threads set likes_count=greatest(0,likes_count-1),updated_at=now() where id=old.thread_id; return old; end if; return null; end $$;
create or replace function public.bump_thread_repost_count() returns trigger language plpgsql security definer set search_path=public as $$ begin if tg_op='INSERT' then update public.threads set reposts_count=reposts_count+1,updated_at=now() where id=new.thread_id; return new; elsif tg_op='DELETE' then update public.threads set reposts_count=greatest(0,reposts_count-1),updated_at=now() where id=old.thread_id; return old; end if; return null; end $$;
create or replace function public.bump_thread_reply_count() returns trigger language plpgsql security definer set search_path=public as $$ begin if tg_op='INSERT' then update public.threads set replies_count=replies_count+1,updated_at=now() where id=new.thread_id; return new; elsif tg_op='DELETE' then update public.threads set replies_count=greatest(0,replies_count-1),updated_at=now() where id=old.thread_id; return old; end if; return null; end $$;
drop trigger if exists thread_likes_count_trigger on public.thread_likes;
create trigger thread_likes_count_trigger after insert or delete on public.thread_likes for each row execute function public.bump_thread_like_count();
drop trigger if exists thread_reposts_count_trigger on public.thread_reposts;
create trigger thread_reposts_count_trigger after insert or delete on public.thread_reposts for each row execute function public.bump_thread_repost_count();
drop trigger if exists thread_replies_count_trigger on public.thread_replies;
create trigger thread_replies_count_trigger after insert or delete on public.thread_replies for each row execute function public.bump_thread_reply_count();
notify pgrst,'reload schema';
