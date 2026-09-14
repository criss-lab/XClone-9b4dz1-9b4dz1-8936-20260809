begin;
-- Production backend contract for Profiles, Communities and Audio Spaces.
-- Safe to run after the existing social/auth migrations: objects are created only
-- when missing, while existing objects receive the columns/indexes/policies they need.

-- -----------------------------------------------------------------------------
-- Profiles support
-- -----------------------------------------------------------------------------
-- Keep the canonical profile table tied 1:1 to auth.users. The existing auth
-- profile trigger remains responsible for initial row creation.
alter table if exists public.profiles enable row level security;
drop policy if exists profiles_public_read on public.profiles;
drop policy if exists profiles_owner_insert on public.profiles;
drop policy if exists profiles_owner_update on public.profiles;
drop policy if exists profiles_owner_delete on public.profiles;
create policy profiles_public_read on public.profiles
  for select to anon, authenticated
  using (true);
create policy profiles_owner_insert on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_owner_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
create policy profiles_owner_delete on public.profiles
  for delete to authenticated
  using (id = (select auth.uid()));
-- Browsing history is referenced by ProfilePage and HistoryPage. Keep it private.
create table if not exists public.browsing_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  view_type text not null check (view_type in ('post','profile','community','space','recording')),
  created_at timestamptz not null default now()
);
alter table public.browsing_history enable row level security;
drop policy if exists browsing_history_own on public.browsing_history;
create policy browsing_history_own on public.browsing_history
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create index if not exists idx_browsing_history_user_created
  on public.browsing_history(user_id, created_at desc);
-- -----------------------------------------------------------------------------
-- Communities
-- -----------------------------------------------------------------------------
create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_name text not null,
  description text,
  icon_url text,
  banner_url text,
  member_count integer not null default 0 check (member_count >= 0),
  post_count integer not null default 0 check (post_count >= 0),
  created_by uuid not null references public.profiles(id) on delete cascade,
  is_private boolean not null default false,
  rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.communities add column if not exists name text;
alter table public.communities add column if not exists display_name text;
alter table public.communities add column if not exists description text;
alter table public.communities add column if not exists icon_url text;
alter table public.communities add column if not exists banner_url text;
alter table public.communities add column if not exists member_count integer not null default 0;
alter table public.communities add column if not exists post_count integer not null default 0;
alter table public.communities add column if not exists created_by uuid;
alter table public.communities add column if not exists is_private boolean not null default false;
alter table public.communities add column if not exists rules jsonb not null default '[]'::jsonb;
alter table public.communities add column if not exists created_at timestamptz not null default now();
alter table public.communities add column if not exists updated_at timestamptz not null default now();
alter table public.communities enable row level security;
create table if not exists public.community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','moderator','member')),
  status text not null default 'active' check (status in ('active','pending','banned')),
  created_at timestamptz not null default now(),
  unique (community_id, user_id)
);
-- Production can contain a legacy community_members table created by an older
-- schema. CREATE TABLE IF NOT EXISTS does not reconcile that shape, so add the
-- columns required by the authorization helpers before defining those helpers.
alter table public.community_members add column if not exists role text not null default 'member';
alter table public.community_members add column if not exists status text not null default 'active';
update public.community_members set role = 'member' where role is null or role = '';
update public.community_members set status = 'active' where status is null or status = '';
alter table public.community_members enable row level security;
create table if not exists public.community_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  reason text,
  score numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, community_id)
);
alter table public.community_suggestions enable row level security;
-- Add the community relationship to posts without changing existing post IDs.
alter table public.posts add column if not exists community_id uuid references public.communities(id) on delete set null;
create index if not exists idx_communities_member_count on public.communities(member_count desc);
create index if not exists idx_communities_created_by on public.communities(created_by);
create index if not exists idx_community_members_user on public.community_members(user_id, created_at desc);
create index if not exists idx_community_members_community on public.community_members(community_id, created_at desc);
create index if not exists idx_posts_community_created on public.posts(community_id, created_at desc);
-- Security-definer helpers avoid recursive RLS evaluation between communities,
-- memberships and posts. They execute with a fixed search_path and only return
-- boolean authorization decisions.
create or replace function public.is_community_member(p_community_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.community_members cm
    where cm.community_id = p_community_id
      and cm.user_id = p_user_id
      and cm.status = 'active'
  );
$$;
create or replace function public.can_manage_community(p_community_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.communities c
    where c.id = p_community_id
      and c.created_by = p_user_id
  ) or exists (
    select 1
    from public.community_members cm
    where cm.community_id = p_community_id
      and cm.user_id = p_user_id
      and cm.role in ('owner','moderator')
      and cm.status = 'active'
  );
$$;
revoke all on function public.is_community_member(uuid, uuid) from public;
revoke all on function public.can_manage_community(uuid, uuid) from public;
grant execute on function public.is_community_member(uuid, uuid) to anon, authenticated;
grant execute on function public.can_manage_community(uuid, uuid) to authenticated;
drop policy if exists communities_public_or_member_read on public.communities;
drop policy if exists communities_create_own on public.communities;
drop policy if exists communities_manage_own on public.communities;
create policy communities_public_or_member_read on public.communities
  for select to anon, authenticated
  using (
    not is_private
    or public.is_community_member(id)
    or created_by = (select auth.uid())
  );
create policy communities_create_own on public.communities
  for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy communities_manage_own on public.communities
  for update to authenticated
  using (public.can_manage_community(id))
  with check (public.can_manage_community(id));
drop policy if exists communities_delete_own on public.communities;
create policy communities_delete_own on public.communities
  for delete to authenticated
  using (created_by = (select auth.uid()));
drop policy if exists community_members_visible on public.community_members;
drop policy if exists community_members_join_own on public.community_members;
drop policy if exists community_members_leave_own on public.community_members;
drop policy if exists community_members_manage on public.community_members;
create policy community_members_visible on public.community_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_community_member(community_id)
    or exists (select 1 from public.communities c where c.id = community_id and not c.is_private)
  );
create policy community_members_join_own on public.community_members
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.communities c where c.id = community_id)
  );
create policy community_members_leave_own on public.community_members
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_community(community_id));
create policy community_members_manage on public.community_members
  for update to authenticated
  using (public.can_manage_community(community_id))
  with check (public.can_manage_community(community_id));
drop policy if exists community_suggestions_own on public.community_suggestions;
create policy community_suggestions_own on public.community_suggestions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- Enforce community membership for community posts. Existing global post policies
-- are adjusted so an owner cannot bypass the community boundary.
drop policy if exists posts_public_read on public.posts;
drop policy if exists posts_owner_insert on public.posts;
drop policy if exists posts_owner_update on public.posts;
drop policy if exists posts_owner_delete on public.posts;
create policy posts_public_read on public.posts
  for select to anon, authenticated
  using (
    community_id is null
    or exists (
      select 1 from public.communities c
      where c.id = community_id
        and (not c.is_private or public.is_community_member(c.id) or c.created_by = (select auth.uid()))
    )
  );
create policy posts_owner_insert on public.posts
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      community_id is null
      or public.is_community_member(community_id)
      or public.can_manage_community(community_id)
    )
  );
create policy posts_owner_update on public.posts
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (
    author_id = (select auth.uid())
    and (
      community_id is null
      or public.is_community_member(community_id)
      or public.can_manage_community(community_id)
    )
  );
create policy posts_owner_delete on public.posts
  for delete to authenticated
  using (author_id = (select auth.uid()));
-- Maintain community counters transactionally from membership/post changes.
create or replace function public.refresh_community_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'community_members' then
    update public.communities c
      set member_count = (select count(*) from public.community_members cm where cm.community_id = c.id and cm.status = 'active'),
          updated_at = now()
      where c.id = coalesce(new.community_id, old.community_id);
  elsif tg_table_name = 'posts' then
    if tg_op = 'UPDATE' and old.community_id is distinct from new.community_id then
      update public.communities c set post_count = (select count(*) from public.posts p where p.community_id = c.id and p.deleted_at is null), updated_at = now() where c.id = old.community_id;
    end if;
    if tg_op in ('INSERT','UPDATE') then
      update public.communities c set post_count = (select count(*) from public.posts p where p.community_id = c.id and p.deleted_at is null), updated_at = now() where c.id = new.community_id;
    elsif tg_op = 'DELETE' then
      update public.communities c set post_count = (select count(*) from public.posts p where p.community_id = c.id and p.deleted_at is null), updated_at = now() where c.id = old.community_id;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_community_member_counts on public.community_members;
create trigger trg_community_member_counts after insert or update or delete on public.community_members for each row execute function public.refresh_community_counts();
drop trigger if exists trg_community_post_counts on public.posts;
create trigger trg_community_post_counts after insert or update or delete on public.posts for each row execute function public.refresh_community_counts();
-- -----------------------------------------------------------------------------
-- Audio Spaces
-- -----------------------------------------------------------------------------
create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  is_live boolean not null default false,
  listener_count integer not null default 0 check (listener_count >= 0),
  has_video boolean not null default false,
  category text not null default 'all',
  artwork_url text,
  episode_number integer,
  chapters jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  subscriber_only boolean not null default false,
  scheduled_for timestamptz,
  ended_at timestamptz,
  is_archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.spaces add column if not exists host_id uuid;
alter table public.spaces add column if not exists title text;
alter table public.spaces add column if not exists description text;
alter table public.spaces add column if not exists is_live boolean not null default false;
alter table public.spaces add column if not exists listener_count integer not null default 0;
alter table public.spaces add column if not exists has_video boolean not null default false;
alter table public.spaces add column if not exists category text not null default 'all';
alter table public.spaces add column if not exists artwork_url text;
alter table public.spaces add column if not exists episode_number integer;
alter table public.spaces add column if not exists chapters jsonb not null default '[]'::jsonb;
alter table public.spaces add column if not exists tags text[] not null default '{}';
alter table public.spaces add column if not exists subscriber_only boolean not null default false;
alter table public.spaces add column if not exists scheduled_for timestamptz;
alter table public.spaces add column if not exists ended_at timestamptz;
alter table public.spaces add column if not exists is_archived boolean not null default false;
alter table public.spaces add column if not exists archived_at timestamptz;
alter table public.spaces add column if not exists created_at timestamptz not null default now();
alter table public.spaces add column if not exists updated_at timestamptz not null default now();
alter table public.spaces enable row level security;
-- If an existing spaces table does not yet have a profile FK, add a dedicated
-- relationship for PostgREST nested profile queries without disturbing legacy FKs.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'spaces_host_profile_fkey'
  ) then
    alter table public.spaces
      add constraint spaces_host_profile_fkey foreign key (host_id) references public.profiles(id) on delete cascade;
  end if;
exception when duplicate_object then null;
end $$;
create table if not exists public.space_participants (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'listener' check (role in ('listener','speaker','cohost','host')),
  is_muted boolean not null default true,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (space_id, user_id)
);
alter table public.space_participants enable row level security;
create table if not exists public.space_recordings (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  audio_url text,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  duration_seconds integer,
  episode_number integer,
  chapters jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  artwork_url text,
  subscriber_only boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.space_recordings enable row level security;
create index if not exists idx_spaces_live on public.spaces(is_live, listener_count desc);
create index if not exists idx_spaces_host_created on public.spaces(host_id, created_at desc);
create index if not exists idx_spaces_scheduled on public.spaces(scheduled_for) where scheduled_for is not null;
create index if not exists idx_space_participants_space on public.space_participants(space_id, joined_at desc);
create index if not exists idx_space_participants_user on public.space_participants(user_id, joined_at desc);
create index if not exists idx_space_recordings_created on public.space_recordings(created_at desc);
create index if not exists idx_space_recordings_host on public.space_recordings(host_id, created_at desc);
create or replace function public.is_space_participant(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.space_participants sp
    where sp.space_id = p_space_id
      and sp.user_id = p_user_id
      and sp.left_at is null
  );
$$;
create or replace function public.is_space_host(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.spaces s
    where s.id = p_space_id and s.host_id = p_user_id
  );
$$;
revoke all on function public.is_space_participant(uuid, uuid) from public;
revoke all on function public.is_space_host(uuid, uuid) from public;
grant execute on function public.is_space_participant(uuid, uuid) to authenticated;
grant execute on function public.is_space_host(uuid, uuid) to authenticated;
drop policy if exists spaces_public_read on public.spaces;
drop policy if exists spaces_host_insert on public.spaces;
drop policy if exists spaces_host_update on public.spaces;
drop policy if exists spaces_host_delete on public.spaces;
create policy spaces_public_read on public.spaces
  for select to anon, authenticated
  using (
    not is_archived
    and (
      not subscriber_only
      or host_id = (select auth.uid())
      or public.is_space_participant(id)
    )
  );
create policy spaces_host_insert on public.spaces
  for insert to authenticated
  with check (host_id = (select auth.uid()));
create policy spaces_host_update on public.spaces
  for update to authenticated
  using (host_id = (select auth.uid()))
  with check (host_id = (select auth.uid()));
create policy spaces_host_delete on public.spaces
  for delete to authenticated
  using (host_id = (select auth.uid()));
drop policy if exists space_participants_visible on public.space_participants;
drop policy if exists space_participants_join on public.space_participants;
drop policy if exists space_participants_leave on public.space_participants;
drop policy if exists space_participants_host_manage on public.space_participants;
create policy space_participants_visible on public.space_participants
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_space_participant(space_id)
    or public.is_space_host(space_id)
  );
create policy space_participants_join on public.space_participants
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.spaces s where s.id = space_id and s.is_live = true and not s.is_archived)
  );
create policy space_participants_leave on public.space_participants
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_space_host(space_id));
create policy space_participants_host_manage on public.space_participants
  for update to authenticated
  using (public.is_space_host(space_id))
  with check (public.is_space_host(space_id));
-- Recordings are public unless explicitly subscriber-only; only the host owns mutations.
drop policy if exists space_recordings_public_read on public.space_recordings;
drop policy if exists space_recordings_host_insert on public.space_recordings;
drop policy if exists space_recordings_host_update on public.space_recordings;
drop policy if exists space_recordings_host_delete on public.space_recordings;
create policy space_recordings_public_read on public.space_recordings
  for select to anon, authenticated
  using (
    not subscriber_only
    or host_id = (select auth.uid())
  );
create policy space_recordings_host_insert on public.space_recordings
  for insert to authenticated
  with check (host_id = (select auth.uid()) and public.is_space_host(space_id));
create policy space_recordings_host_update on public.space_recordings
  for update to authenticated
  using (host_id = (select auth.uid()))
  with check (host_id = (select auth.uid()));
create policy space_recordings_host_delete on public.space_recordings
  for delete to authenticated
  using (host_id = (select auth.uid()));
-- Listener counts are derived from participants, not trusted client input.
create or replace function public.sync_space_listener_count(p_space_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.spaces
  set listener_count = (
    select count(*) from public.space_participants
    where space_id = p_space_id and left_at is null
  ), updated_at = now()
  where id = p_space_id;
$$;
revoke all on function public.sync_space_listener_count(uuid) from public;
grant execute on function public.sync_space_listener_count(uuid) to authenticated;
create or replace function public.space_participant_count_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_space_listener_count(coalesce(new.space_id, old.space_id));
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_space_participant_count on public.space_participants;
create trigger trg_space_participant_count after insert or update or delete on public.space_participants for each row execute function public.space_participant_count_trigger();
-- Realtime for the social surfaces that actually need live state.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.community_members; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.spaces; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.space_participants; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  end if;
end $$;
commit;
