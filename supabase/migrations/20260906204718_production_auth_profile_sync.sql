create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_name text;
  base_username text;
  candidate text;
  suffix text;
begin
  raw_name := coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), nullif(new.raw_user_meta_data ->> 'preferred_username', ''), nullif(new.raw_user_meta_data ->> 'user_name', ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''));
  base_username := lower(regexp_replace(coalesce(raw_name, 'user'), '[^a-z0-9_]+', '_', 'g'));
  base_username := regexp_replace(base_username, '^_+|_+$', '', 'g');
  if char_length(base_username) < 3 then base_username := 'user'; end if;
  base_username := left(base_username, 24);
  candidate := base_username;
  suffix := substr(replace(new.id::text, '-', ''), 1, 8);
  if exists (select 1 from public.profiles where username = candidate and id <> new.id) then candidate := left(base_username, 15) || '_' || suffix; end if;
  insert into public.profiles (id, username, display_name, avatar_url, bio, website, location)
  values (new.id, candidate, coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), ''), coalesce(nullif(new.raw_user_meta_data ->> 'avatar_url', ''), nullif(new.raw_user_meta_data ->> 'picture', '')), nullif(new.raw_user_meta_data ->> 'bio', ''), nullif(new.raw_user_meta_data ->> 'website', ''), nullif(new.raw_user_meta_data ->> 'location', ''))
  on conflict (id) do update set
    display_name = case when public.profiles.display_name = '' then excluded.display_name else public.profiles.display_name end,
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    bio = coalesce(public.profiles.bio, excluded.bio),
    website = coalesce(public.profiles.website, excluded.website),
    location = coalesce(public.profiles.location, excluded.location),
    updated_at = now();
  return new;
end;
$$;

create or replace function public.sync_auth_user_to_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  desired_username text;
  candidate text;
  suffix text;
begin
  desired_username := lower(regexp_replace(coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), nullif(new.raw_user_meta_data ->> 'preferred_username', ''), nullif(new.raw_user_meta_data ->> 'user_name', '')), '[^a-z0-9_]+', '_', 'g'));
  desired_username := regexp_replace(coalesce(desired_username, ''), '^_+|_+$', '', 'g');
  if char_length(desired_username) >= 3 then
    candidate := left(desired_username, 24);
    suffix := substr(replace(new.id::text, '-', ''), 1, 8);
    if exists (select 1 from public.profiles where username = candidate and id <> new.id) then candidate := left(candidate, 15) || '_' || suffix; end if;
  else
    candidate := null;
  end if;
  update public.profiles
  set username = coalesce(candidate, username),
      display_name = coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), display_name),
      avatar_url = coalesce(nullif(new.raw_user_meta_data ->> 'avatar_url', ''), nullif(new.raw_user_meta_data ->> 'picture', ''), avatar_url),
      updated_at = now()
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated_profile on auth.users;
create trigger on_auth_user_updated_profile
after update of raw_user_meta_data on auth.users
for each row execute function public.sync_auth_user_to_profile();

update public.profiles p
set username = coalesce(nullif(u.raw_user_meta_data ->> 'username',''), nullif(u.raw_user_meta_data ->> 'preferred_username',''), nullif(u.raw_user_meta_data ->> 'user_name',''), p.username),
    display_name = coalesce(nullif(p.display_name,''), nullif(u.raw_user_meta_data ->> 'full_name',''), nullif(u.raw_user_meta_data ->> 'name',''), ''),
    avatar_url = coalesce(p.avatar_url, nullif(u.raw_user_meta_data ->> 'avatar_url',''), nullif(u.raw_user_meta_data ->> 'picture','')),
    updated_at = now()
from auth.users u
where u.id = p.id;

revoke all on function public.handle_new_user() from public;
revoke all on function public.sync_auth_user_to_profile() from public;
