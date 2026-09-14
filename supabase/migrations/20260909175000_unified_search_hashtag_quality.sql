begin;

-- Keep type-filtered search useful when the first N global results are dominated
-- by another kind. Also make hashtag counts reflect both native and federated posts.
create or replace function public.search_everything(p_query text,p_limit integer,p_type text)
returns table(kind text,id text,score real,title text,subtitle text,content text,url text,source text,created_at timestamptz,actor_uri text)
language sql security definer set search_path=public as $$
with f as (
  select lower(coalesce(nullif(trim(p_type),''),'all')) as search_type,
         least(greatest(coalesce(p_limit,40),1),80) as requested_limit
),
r as (
  select * from public.search_everything(
    p_query,
    case when (select search_type from f)='all' then (select requested_limit from f) else 80 end
  )
),
filtered as (
  select r.*
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
)
select filtered.kind,
       filtered.id,
       filtered.score,
       filtered.title,
       case when filtered.kind='hashtag' then
         (
           (select count(*) from public.post_hashtags ph join public.hashtags h on h.id=ph.hashtag_id where h.id=filtered.id::uuid)
           +
           (select count(*) from public.federated_object_hashtags foh where foh.hashtag_id=filtered.id::uuid)
         )::text || ' posts'
       else filtered.subtitle end as subtitle,
       filtered.content,
       filtered.url,
       filtered.source,
       filtered.created_at,
       filtered.actor_uri
from filtered
order by filtered.score desc,filtered.created_at desc nulls last
limit (select requested_limit from f);
$$;

revoke all on function public.search_everything(text,integer,text) from public;
grant execute on function public.search_everything(text,integer,text) to authenticated;

commit;
