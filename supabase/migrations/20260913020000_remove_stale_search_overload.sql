-- Remove the obsolete three-argument search_everything overload.
-- The canonical production search_everything(text, integer) TABLE contract is preserved.
-- The typed API lives in search_everything_by_type(text, integer, text).

drop function if exists public.search_everything(text, integer, text);

drop function if exists public.search_everything_by_type(text, integer, text);

create or replace function public.search_everything_by_type(
  p_query text,
  p_limit integer default 40,
  p_type text default 'all'
)
returns table(
  kind text,
  id text,
  score real,
  title text,
  subtitle text,
  content text,
  url text,
  source text,
  created_at timestamptz,
  actor_uri text
)
language sql
security definer
set search_path=public
as $$
  select r.*
  from public.search_everything(
    p_query,
    least(greatest(coalesce(p_limit,40),1),80)
  ) r
  where lower(coalesce(p_type,'all'))='all'
     or (lower(p_type)='users' and r.kind in ('user','fediverse_user'))
     or (lower(p_type)='posts' and r.kind in ('post','fediverse_post'))
     or (lower(p_type)='hashtags' and r.kind='hashtag')
     or (lower(p_type)='instances' and r.kind='instance')
     or (lower(p_type)='communities' and r.kind='community')
     or (lower(p_type)='products' and r.kind='product')
     or (lower(p_type)='fediverse_users' and r.kind='fediverse_user')
     or (lower(p_type)='fediverse_posts' and r.kind='fediverse_post')
  order by r.score desc, r.created_at desc nulls last
  limit least(greatest(coalesce(p_limit,40),1),80);
$$;

revoke all on function public.search_everything_by_type(text,integer,text) from public;
grant execute on function public.search_everything_by_type(text,integer,text) to authenticated;
