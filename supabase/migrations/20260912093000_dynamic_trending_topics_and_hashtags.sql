create table if not exists public.trending_topics (
  id uuid primary key default gen_random_uuid(),
  topic text not null unique,
  posts_count bigint not null default 0,
  trend_score numeric not null default 0,
  window_hours integer not null default 168,
  updated_at timestamptz not null default now()
);

create table if not exists public.trending_hashtags (
  hashtag_id uuid primary key references public.hashtags(id) on delete cascade,
  trend_score numeric not null default 0,
  daily_posts bigint not null default 0,
  weekly_posts bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.hashtags add column if not exists usage_count bigint;

create or replace function public.refresh_trending_topics()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  since_7d timestamptz := now() - interval '7 days';
  since_24h timestamptz := now() - interval '24 hours';
begin
  with native_hashtags as (
    select lower(m[1]) as tag, p.id, p.created_at,
      coalesce(p.likes_count,0) + coalesce(p.reposts_count,0) * 2 + coalesce(p.replies_count,0) * 2 + coalesce(p.views_count,0) * 0.05 as engagement
    from public.posts p
    cross join lateral regexp_matches(coalesce(p.content,''), '#([[:alnum:]_]{2,64})', 'gi') m
    where p.created_at >= since_7d and p.deleted_at is null and coalesce(p.visibility,'public') in ('public','unlisted')
  ), remote_hashtags as (
    select lower(m[1]) as tag, f.id, coalesce(f.published_at,f.created_at) as created_at,
      coalesce(f.like_count,0) + coalesce(f.announce_count,0) * 2 + coalesce(f.reply_count,0) * 2 + coalesce(f.view_count,0) * 0.05 as engagement
    from public.federated_objects f
    cross join lateral regexp_matches(coalesce(f.content,'') || ' ' || coalesce(f.summary,''), '#([[:alnum:]_]{2,64})', 'gi') m
    where coalesce(f.published_at,f.created_at) >= since_7d and f.deleted_at is null
  ), all_tags as (
    select * from native_hashtags union all select * from remote_hashtags
  ), ranked as (
    select tag, count(*)::bigint as weekly_posts,
      count(*) filter (where created_at >= since_24h)::bigint as daily_posts,
      sum(engagement * exp(-extract(epoch from (now()-created_at))/86400.0/3.0)) as score
    from all_tags group by tag
  )
  insert into public.hashtags(tag, post_count, last_used_at, usage_count)
  select tag, weekly_posts, now(), weekly_posts from ranked
  on conflict (tag) do update set post_count=excluded.post_count, last_used_at=excluded.last_used_at, usage_count=excluded.usage_count;

  with ranked as (
    select lower(m[1]) as tag, count(*)::bigint as weekly_posts,
      count(*) filter (where p.created_at >= since_24h)::bigint as daily_posts,
      sum((coalesce(p.likes_count,0) + coalesce(p.reposts_count,0)*2 + coalesce(p.replies_count,0)*2 + coalesce(p.views_count,0)*0.05) * exp(-extract(epoch from (now()-p.created_at))/86400.0/3.0)) as score
    from public.posts p cross join lateral regexp_matches(coalesce(p.content,''), '#([[:alnum:]_]{2,64})', 'gi') m
    where p.created_at >= since_7d and p.deleted_at is null and coalesce(p.visibility,'public') in ('public','unlisted')
    group by lower(m[1])
  ), remote_ranked as (
    select lower(m[1]) as tag, count(*)::bigint as weekly_posts,
      count(*) filter (where coalesce(f.published_at,f.created_at) >= since_24h)::bigint as daily_posts,
      sum((coalesce(f.like_count,0) + coalesce(f.announce_count,0)*2 + coalesce(f.reply_count,0)*2 + coalesce(f.view_count,0)*0.05) * exp(-extract(epoch from (now()-coalesce(f.published_at,f.created_at)))/86400.0/3.0)) as score
    from public.federated_objects f cross join lateral regexp_matches(coalesce(f.content,'') || ' ' || coalesce(f.summary,''), '#([[:alnum:]_]{2,64})', 'gi') m
    where coalesce(f.published_at,f.created_at) >= since_7d and f.deleted_at is null
    group by lower(m[1])
  ), combined as (
    select tag, sum(weekly_posts)::bigint weekly_posts, sum(daily_posts)::bigint daily_posts, sum(score) score from (select * from ranked union all select * from remote_ranked) x group by tag
  )
  insert into public.trending_hashtags(hashtag_id, trend_score, daily_posts, weekly_posts, updated_at)
  select h.id, c.score, c.daily_posts, c.weekly_posts, now() from combined c join public.hashtags h on h.tag=c.tag
  on conflict (hashtag_id) do update set trend_score=excluded.trend_score, daily_posts=excluded.daily_posts, weekly_posts=excluded.weekly_posts, updated_at=excluded.updated_at;

  delete from public.trending_hashtags th where not exists (select 1 from public.hashtags h where h.id=th.hashtag_id and h.last_used_at >= since_7d);

  with corpus as (
    select p.content as text, p.created_at,
      coalesce(p.likes_count,0) + coalesce(p.reposts_count,0)*2 + coalesce(p.replies_count,0)*2 + coalesce(p.views_count,0)*0.05 as engagement
    from public.posts p where p.created_at >= since_7d and p.deleted_at is null and coalesce(p.visibility,'public') in ('public','unlisted')
    union all
    select coalesce(f.content,'') || ' ' || coalesce(f.summary,''), coalesce(f.published_at,f.created_at),
      coalesce(f.like_count,0) + coalesce(f.announce_count,0)*2 + coalesce(f.reply_count,0)*2 + coalesce(f.view_count,0)*0.05
    from public.federated_objects f where coalesce(f.published_at,f.created_at) >= since_7d and f.deleted_at is null
  ), words as (
    select lower(regexp_replace(w,'[^a-z0-9_#]','','g')) as topic, c.created_at, c.engagement
    from corpus c cross join lateral regexp_split_to_table(lower(coalesce(c.text,'')), '\s+') w
  ), meaningful as (
    select topic, count(*)::bigint as cnt,
      sum(engagement * exp(-extract(epoch from (now()-created_at))/86400.0/3.0)) as score
    from words where length(topic) between 3 and 40
      and topic !~ '^#[0-9_]+$'
      and topic not in ('the','and','for','with','that','this','from','have','your','you','are','was','will','not','but','can','our','they','their','about','into','just','like','what','when','where','how','all','new','today','testagram','https','www')
    group by topic
  )
  insert into public.trending_topics(topic, posts_count, trend_score, window_hours, updated_at)
  select topic, cnt, coalesce(score,0), 168, now() from meaningful where cnt >= 2
  order by score desc limit 100
  on conflict (topic) do update set posts_count=excluded.posts_count, trend_score=excluded.trend_score, window_hours=excluded.window_hours, updated_at=excluded.updated_at;

  delete from public.trending_topics where updated_at < now() - interval '2 hours';
end;
$$;

grant select on public.trending_topics, public.trending_hashtags to anon, authenticated;
grant execute on function public.refresh_trending_topics() to anon, authenticated, service_role;
