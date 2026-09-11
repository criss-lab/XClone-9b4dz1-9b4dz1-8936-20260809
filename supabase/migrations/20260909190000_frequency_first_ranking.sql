begin;

-- Content feeds are intentionally frequency-first: the item used most often
-- (likes, replies, reposts, or federated Like/Announce activity) appears first.
-- There is no arbitrary weighted popularity formula or hidden decay score.
-- Recency is only a deterministic tie-breaker when frequency is equal.

-- Search hashtags separately from content ranking. Hashtag discovery may use
-- an explicit numeric usage count across native and federated objects.
create or replace function public.search_everything(p_query text,p_limit integer default 40)
returns table(kind text,id text,score real,title text,subtitle text,content text,url text,source text,created_at timestamptz,actor_uri text)
language sql security definer set search_path=public as $$
with s as (
  select trim(regexp_replace(coalesce(p_query,''),'\\s+',' ','g')) q,
         least(greatest(coalesce(p_limit,40),1),80) lim
),
t as (
  select q,lim,case when q='' then null else websearch_to_tsquery('simple',q) end query
  from s
),
hu as (
  select h.id,h.tag,h.last_used_at,
         (coalesce(np.usage_count,0)+coalesce(fp.usage_count,0))::bigint as usage_count
  from public.hashtags h
  left join (
    select ph.hashtag_id,count(*)::bigint usage_count
    from public.post_hashtags ph
    join public.posts p on p.id=ph.post_id
    where p.visibility='public' and p.deleted_at is null
    group by ph.hashtag_id
  ) np on np.hashtag_id=h.id
  left join (
    select f.hashtag_id,count(*)::bigint usage_count
    from public.federated_object_hashtags f
    join public.federated_objects o on o.id=f.object_id
    where not o.sensitive and o.deleted_at is null
    group by f.hashtag_id
  ) fp on fp.hashtag_id=h.id
),
r as (
  select 'user'::text kind,p.id::text id,
    (coalesce(ts_rank_cd(to_tsvector('simple',coalesce(p.username,'')||' '||coalesce(p.display_name,'')||' '||coalesce(p.bio,'')),t.query),0)+case when lower(p.username)=lower(t.q) then 5 when lower(p.username) like lower(t.q)||'%' then 1 else 0 end)::real score,
    coalesce(nullif(p.display_name,''),p.username) title,'@'||p.username subtitle,coalesce(p.bio,'') content,null::text url,'testagram'::text source,p.created_at,null::text actor_uri
  from public.profiles p cross join t
  where t.q<>'' and(to_tsvector('simple',coalesce(p.username,'')||' '||coalesce(p.display_name,'')||' '||coalesce(p.bio,'')) @@ t.query or lower(p.username) like lower(t.q)||'%')
  union all
  select 'post',p.id::text,coalesce(ts_rank_cd(to_tsvector('simple',coalesce(p.content,'')),t.query),0)::real,coalesce(nullif(pr.display_name,''),pr.username,'Testagram'),case when pr.username is null then null else '@'||pr.username end,p.content,null,'testagram',p.created_at,null
  from public.posts p cross join t left join public.profiles pr on pr.id=coalesce(p.author_id,p.user_id)
  where t.q<>'' and p.visibility='public' and p.deleted_at is null and to_tsvector('simple',coalesce(p.content,'')) @@ t.query
  union all
  select 'hashtag',hu.id::text,hu.usage_count::real,'#'||hu.tag,hu.usage_count::text||' uses',null,null,'testagram',hu.last_used_at,null
  from hu cross join t
  where t.q<>'' and lower(hu.tag) like '%'||lower(regexp_replace(t.q,'^#',''))||'%'
  union all
  select 'community',c.id::text,coalesce(ts_rank_cd(to_tsvector('simple',coalesce(c.name,'')||' '||coalesce(c.slug,'')||' '||coalesce(c.description,'')),t.query),0)::real,c.name,c.slug,c.description,null,'testagram',c.created_at,null
  from public.communities c cross join t
  where t.q<>'' and not c.is_private and to_tsvector('simple',coalesce(c.name,'')||' '||coalesce(c.slug,'')||' '||coalesce(c.description,'')) @@ t.query
  union all
  select 'product',p.id::text,coalesce(ts_rank_cd(to_tsvector('simple',coalesce(p.name,'')||' '||coalesce(p.description,'')),t.query),0)::real,p.name,p.currency,p.description,p.external_url,'testagram',p.created_at,null
  from public.products p cross join t
  where t.q<>'' and to_tsvector('simple',coalesce(p.name,'')||' '||coalesce(p.description,'')) @@ t.query
  union all
  select 'fediverse_user',a.id::text,(coalesce(ts_rank_cd(to_tsvector('simple',coalesce(a.preferred_username,'')||' '||coalesce(a.display_name,'')||' '||coalesce(a.summary,'')),t.query),0)+.25)::real,coalesce(nullif(a.display_name,''),a.preferred_username,'Fediverse user'),'@'||coalesce(a.preferred_username,'')||case when i.domain is null then '' else '@'||i.domain end,a.summary,a.uri,'fediverse',a.created_at,a.uri
  from public.federated_actors a cross join t left join public.federated_instances i on i.id=a.instance_id
  where t.q<>'' and a.discoverable and not a.suspended and to_tsvector('simple',coalesce(a.preferred_username,'')||' '||coalesce(a.display_name,'')||' '||coalesce(a.summary,'')) @@ t.query
  union all
  select 'fediverse_post',o.id::text,coalesce(ts_rank_cd(to_tsvector('simple',coalesce(o.content,'')||' '||coalesce(o.summary,'')),t.query),0)::real,coalesce(a.display_name,a.preferred_username,'Fediverse post'),coalesce(i.domain,'Fediverse'),o.content,coalesce(o.url,o.uri),'fediverse',coalesce(o.published_at,o.created_at),o.actor_uri
  from public.federated_objects o cross join t left join public.federated_actors a on a.uri=o.actor_uri left join public.federated_instances i on i.id=o.instance_id
  where t.q<>'' and not o.sensitive and o.deleted_at is null and to_tsvector('simple',coalesce(o.content,'')||' '||coalesce(o.summary,'')) @@ t.query
  union all
  select 'instance',i.id::text,(coalesce(ts_rank_cd(to_tsvector('simple',coalesce(i.domain,'')||' '||coalesce(i.software_name,'')),t.query),0)+.5)::real,i.domain,coalesce(i.software_name,'ActivityPub'),i.software_version,null,'fediverse',i.created_at,null
  from public.federated_instances i cross join t
  where t.q<>'' and i.status<>'blocked' and to_tsvector('simple',coalesce(i.domain,'')||' '||coalesce(i.software_name,'')) @@ t.query
)
select r.* from r where r.score>0 order by r.score desc,r.created_at desc nulls last limit(select lim from s);
$$;

-- Keep the three-argument API wrapper deterministic while allowing the base
-- function to calculate the full unified hashtag frequency first.
create or replace function public.search_everything(p_query text,p_limit integer,p_type text)
returns table(kind text,id text,score real,title text,subtitle text,content text,url text,source text,created_at timestamptz,actor_uri text)
language sql security definer set search_path=public as $$
with r as (select * from public.search_everything(p_query,greatest(coalesce(p_limit,40),80))), f as (select lower(coalesce(nullif(trim(p_type),''),'all')) as search_type)
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

create index if not exists post_analytics_frequency_idx on public.post_analytics(reposts desc,replies desc,likes desc);
create index if not exists federated_object_hashtags_frequency_idx on public.federated_object_hashtags(hashtag_id,object_id);

revoke all on function public.search_everything(text,integer) from public;
revoke all on function public.search_everything(text,integer,text) from public;
grant execute on function public.search_everything(text,integer) to authenticated;
grant execute on function public.search_everything(text,integer,text) to authenticated;

commit;
