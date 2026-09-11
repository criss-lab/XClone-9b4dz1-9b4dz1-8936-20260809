create or replace function public.sync_auth_user_to_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_name text;
  desired_username text;
  candidate text;
  suffix text;
begin
  raw_name := coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), nullif(new.raw_user_meta_data ->> 'preferred_username', ''), nullif(new.raw_user_meta_data ->> 'user_name', ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''));
  desired_username := lower(regexp_replace(coalesce(raw_name, 'user'), '[^a-z0-9_]+', '_', 'g'));
  desired_username := regexp_replace(desired_username, '^_+|_+$', '', 'g');
  if char_length(desired_username) < 3 then desired_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10); end if;
  desired_username := left(desired_username, 24);
  candidate := desired_username;
  suffix := substr(replace(new.id::text, '-', ''), 1, 8);
  if exists (select 1 from public.profiles where username = candidate and id <> new.id) then candidate := left(desired_username, 15) || '_' || suffix; end if;
  update public.profiles
  set username = case when username is null or username like 'user_%' then candidate else username end,
      display_name = coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), display_name),
      avatar_url = coalesce(nullif(new.raw_user_meta_data ->> 'avatar_url', ''), nullif(new.raw_user_meta_data ->> 'picture', ''), avatar_url),
      updated_at = now()
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated_profile on auth.users;
create trigger on_auth_user_updated_profile after update of raw_user_meta_data on auth.users for each row execute function public.sync_auth_user_to_profile();

with candidates as (
  select p.id, left(lower(regexp_replace(coalesce(nullif(u.raw_user_meta_data->>'username',''), nullif(u.raw_user_meta_data->>'preferred_username',''), nullif(u.raw_user_meta_data->>'user_name',''), nullif(split_part(coalesce(u.email,''),'@',1),''), 'user'), '[^a-z0-9_]+', '_', 'g')), 24) as base_username
  from public.profiles p join auth.users u on u.id=p.id
  where p.username is null or p.username like 'user_%'
), normalized as (
  select id, case when char_length(regexp_replace(base_username, '^_+|_+$', '', 'g')) >= 3 then regexp_replace(base_username, '^_+|_+$', '', 'g') else 'user_' || substr(replace(id::text,'-',''),1,10) end as base_username
  from candidates
), ranked as (
  select id, base_username, row_number() over (partition by base_username order by id) as rn from normalized
)
update public.profiles p
set username = case when r.rn = 1 then r.base_username else left(r.base_username, 15) || '_' || substr(replace(r.id::text,'-',''),1,8) end,
    updated_at = now()
from ranked r
where p.id=r.id;
;
