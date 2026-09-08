begin;

-- The existing profile-sync migration defines handle_new_user(), but production
-- also needs the auth.users INSERT trigger. Without it, a newly created Auth user
-- can authenticate while public.profiles remains empty.
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill any Auth users that predate the trigger without overwriting profile data.
insert into public.profiles (id, username, display_name, avatar_url, bio, website, location)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data ->> 'username',''), nullif(u.raw_user_meta_data ->> 'preferred_username',''), nullif(u.raw_user_meta_data ->> 'user_name',''), 'user_' || substr(replace(u.id::text,'-',''),1,8)),
  coalesce(nullif(u.raw_user_meta_data ->> 'full_name',''), nullif(u.raw_user_meta_data ->> 'name',''), ''),
  coalesce(nullif(u.raw_user_meta_data ->> 'avatar_url',''), nullif(u.raw_user_meta_data ->> 'picture','')),
  nullif(u.raw_user_meta_data ->> 'bio',''),
  nullif(u.raw_user_meta_data ->> 'website',''),
  nullif(u.raw_user_meta_data ->> 'location','')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- Explicit Data API grants. RLS decides which rows are accessible; grants decide
-- which operations the role can attempt in the first place.
grant select on public.profiles to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;

grant select on public.communities to anon, authenticated;
grant insert, update, delete on public.communities to authenticated;
grant select, insert, update, delete on public.community_members to authenticated;
grant select, insert, update, delete on public.community_suggestions to authenticated;

grant select, insert, update, delete on public.spaces to authenticated;
grant select on public.spaces to anon;
grant select, insert, update, delete on public.space_participants to authenticated;
grant select, insert, update, delete on public.space_recordings to authenticated;
grant select, insert, update, delete on public.browsing_history to authenticated;

-- Posts remain publicly readable where their RLS policy allows it, but community
-- membership is enforced by the policies in the preceding migration.
grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;

-- Keep security-definer helpers inaccessible to the public Data API except for
-- the explicit authorization calls required by RLS.
revoke all on function public.handle_new_user() from public;
revoke all on function public.sync_auth_user_to_profile() from public;
revoke all on function public.refresh_community_counts() from public;
revoke all on function public.space_participant_count_trigger() from public;

commit;
