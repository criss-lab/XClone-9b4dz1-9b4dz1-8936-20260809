begin;

-- Keep the established two-argument search function intact and add an explicit
-- three-argument overload for API-side type filtering. No defaults are used on
-- the overload so PostgreSQL cannot confuse it with the existing function.
create or replace function public.search_everything(p_query text,p_limit integer,p_type text)
returns table(kind text,id text,score real,title text,subtitle text,content text,url text,source text,created_at timestamptz,actor_uri text)
language sql security definer set search_path=public as $$
with r as (select * from public.search_everything(p_query,p_limit)), f as (
  select lower(coalesce(nullif(trim(p_type),''),'all')) as search_type
)
select r.kind,r.id,r.score,r.title,r.subtitle,r.content,r.url,r.source,r.created_at,r.actor_uri
from r cross join f
where f.search_type='all'
   or (f.search_type='users' and r.kind in ('user','fediverse_user'))
   or (f.search_type='posts' and r.kind in ('post','fediverse_post'))
   or (f.search_type='hashtags' and r.kind='hashtag')
   or (f.search_type='instances' and r.kind='instance')
   or (f.search_type='communities' and r.kind='community')
   or (f.search_type='products' and r.kind='product')
   or (f.search_type='fediverse_users' and r.kind='fediverse_user')
   or (f.search_type='fediverse_posts' and r.kind='fediverse_post')
order by r.score desc,r.created_at desc nulls last
limit least(greatest(coalesce(p_limit,40),1),80);
$$;
revoke all on function public.search_everything(text,integer,text) from public;
grant execute on function public.search_everything(text,integer,text) to authenticated;
commit;
