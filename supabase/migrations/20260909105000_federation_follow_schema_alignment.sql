begin;
-- The canonical Cloudflare ActivityPub inbox already persists follower
-- relationships as (local_user_id, remote_actor_uri, relationship, state).
-- Align the legacy table used by that handler without rewriting federation data.
alter table public.federation_relationships
  add column if not exists local_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists remote_actor_uri text,
  add column if not exists state text not null default 'pending';
update public.federation_relationships
set local_user_id = coalesce(local_user_id, user_id),
    remote_actor_uri = coalesce(remote_actor_uri, remote_actor_url),
    state = case
      when relationship = 'accepted' then 'accepted'
      when relationship = 'following' then 'active'
      when relationship = 'rejected' then 'rejected'
      else coalesce(state, 'pending')
    end
where local_user_id is null
   or remote_actor_uri is null
   or state is null;
alter table public.federation_relationships
  alter column local_user_id set not null,
  alter column remote_actor_uri set not null;
alter table public.federation_relationships
  drop constraint if exists federation_relationships_relationship_check,
  drop constraint if exists federation_relationships_state_check;
alter table public.federation_relationships
  add constraint federation_relationships_relationship_check
    check (relationship in ('pending','accepted','following','follower','rejected','unfollow_pending','unfollowed','failed')),
  add constraint federation_relationships_state_check
    check (state in ('pending','accepted','rejected','active','removed'));
create unique index if not exists federation_relationships_follow_unique_idx
  on public.federation_relationships(local_user_id, remote_actor_uri, relationship);
create index if not exists federation_relationships_followers_idx
  on public.federation_relationships(local_user_id, relationship, state, updated_at desc)
  where relationship = 'follower' and state = 'accepted';
commit;
