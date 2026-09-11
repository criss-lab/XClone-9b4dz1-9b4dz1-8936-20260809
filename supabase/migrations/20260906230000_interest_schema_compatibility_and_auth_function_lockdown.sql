-- Keep the frontend's hashtag-based interest flow compatible with the production schema.
alter table public.user_interests add column if not exists topic text;
alter table public.user_interests add column if not exists hashtag_id uuid references public.hashtags(id) on delete cascade;
alter table public.user_interests add column if not exists interest_score numeric not null default 1.0;
alter table public.user_interests add column if not exists last_interaction timestamptz;
insert into public.hashtags(tag)
select distinct lower(trim(topic))
from public.user_interests
where topic is not null and trim(topic) <> ''
on conflict (tag) do nothing;
update public.user_interests ui
set hashtag_id = h.id
from public.hashtags h
where ui.hashtag_id is null and lower(trim(ui.topic)) = h.tag;
alter table public.user_interests drop constraint if exists user_interests_pkey;
alter table public.user_interests alter column topic drop not null;
alter table public.user_interests alter column hashtag_id set not null;
alter table public.user_interests add constraint user_interests_pkey primary key (user_id, hashtag_id);
create index if not exists user_interests_user_weight_idx on public.user_interests(user_id, interest_score desc);
do $$
begin
  if to_regprocedure('public.sync_auth_user_to_profile()') is not null then
    revoke execute on function public.sync_auth_user_to_profile() from anon, authenticated;
    grant execute on function public.sync_auth_user_to_profile() to service_role;
  end if;
end
$$;
