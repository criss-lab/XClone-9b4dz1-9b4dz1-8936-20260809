begin;

create or replace function public.user_profiles(public.replies)
returns setof public.user_profiles
rows 1
stable
security invoker
language sql
as $$
  select up.*
  from public.user_profiles up
  where up.id = $1.user_id;
$$;

notify pgrst, 'reload schema';

commit;