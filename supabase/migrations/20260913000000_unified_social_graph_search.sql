-- Unified social graph, hashtag following, hashtag indexing and search.
-- Compatibility-first: existing production RPC return contracts are preserved.

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'accepted', created_at timestamptz not null default now(), accepted_at timestamptz,
  primary key (follower_id, following_id), check (follower_id <> following_id)
);
alter table public.follows add column if not exists status text not null default 'accepted';
alter table public.follows add column if not exists accepted_at timestamptz;
alter table public.follows drop constraint if exists follows_status_check;
alter table public.follows add constraint follows_status_check check (status in ('pending','accepted','rejected'));
create index if not exists follows_follower_status_idx on public.follows(follower_id,status,created_at desc);
create index if not exists follows_following_status_idx on public.follows(following_id,status,created_at desc);

create table if not exists public.hashtag_follows (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, hashtag_id uuid not null references public.hashtags(id) on delete cascade, created_at timestamptz not null default now()
);
alter table public.hashtag_follows add column if not exists id uuid default gen_random_uuid();
alter table public.hashtag_follows add column if not exists user_id uuid;
alter table public.hashtag_follows add column if not exists hashtag_id uuid;
alter table public.hashtag_follows add column if not exists created_at timestamptz not null default now();
create unique index if not exists hashtag_follows_user_tag_uidx on public.hashtag_follows(user_id,hashtag_id);
create index if not exists hashtag_follows_tag_idx on public.hashtag_follows(hashtag_id,created_at desc);

alter table public.hashtags add column if not exists usage_count bigint not null default 0;
alter table public.hashtags add column if not exists follower_count bigint not null default 0;
create index if not exists hashtags_tag_prefix_idx on public.hashtags(tag text_pattern_ops);
create index if not exists hashtags_usage_idx on public.hashtags(usage_count desc,last_used_at desc);

create or replace function public.sync_post_hashtags() returns trigger language plpgsql security invoker set search_path=public as $$
declare source_text text; m text[]; tag_value text; hid uuid; affected_ids uuid[] := '{}'::uuid[];
begin
 if tg_op <> 'INSERT' then
   affected_ids := coalesce((select array_agg(ph.hashtag_id) from public.post_hashtags ph where ph.post_id=old.id),'{}'::uuid[]);
   delete from public.post_hashtags where post_id=old.id;
 end if;
 if tg_op <> 'DELETE' then
   source_text:=coalesce(to_jsonb(new)->>'body','')||' '||coalesce(to_jsonb(new)->>'content','');
   for m in select regexp_matches(source_text,'#([[:alnum:]_]{1,64})','g') loop
    tag_value:=lower(m[1]); if tag_value='' then continue; end if;
    insert into public.hashtags(tag,last_used_at) values(tag_value,now()) on conflict(tag) do update set last_used_at=excluded.last_used_at returning id into hid;
    if hid is null then select id into hid from public.hashtags where tag=tag_value; end if;
    insert into public.post_hashtags(post_id,hashtag_id,created_at) values(new.id,hid,now()) on conflict do nothing;
    affected_ids:=array_append(affected_ids,hid);
   end loop;
 end if;
 if cardinality(affected_ids)>0 then
   update public.hashtags h set post_count=coalesce((select count(*) from public.post_hashtags ph where ph.hashtag_id=h.id),0),usage_count=coalesce((select count(*) from public.post_hashtags ph where ph.hashtag_id=h.id),0),follower_count=coalesce((select count(*) from public.hashtag_follows hf where hf.hashtag_id=h.id),0),last_used_at=coalesce((select max(ph.created_at) from public.post_hashtags ph where ph.hashtag_id=h.id),h.last_used_at) where h.id=any(affected_ids);
 end if;
 return coalesce(new,old);
end; $$;
drop trigger if exists posts_sync_hashtags on public.posts;
create trigger posts_sync_hashtags after insert or update or delete on public.posts for each row execute function public.sync_post_hashtags();

do $$
declare p record; m text[]; tag_value text; hid uuid;
begin
 for p in select id,coalesce(to_jsonb(posts)->>'body','')||' '||coalesce(to_jsonb(posts)->>'content','') source_text from public.posts loop
  for m in select regexp_matches(p.source_text,'#([[:alnum:]_]{1,64})','g') loop
   tag_value:=lower(m[1]); insert into public.hashtags(tag,last_used_at) values(tag_value,now()) on conflict(tag) do nothing returning id into hid;
   if hid is null then select id into hid from public.hashtags where tag=tag_value; end if;
   insert into public.post_hashtags(post_id,hashtag_id) values(p.id,hid) on conflict do nothing;
  end loop;
 end loop;
 update public.hashtags h set post_count=coalesce((select count(*) from public.post_hashtags ph where ph.hashtag_id=h.id),0),usage_count=coalesce((select count(*) from public.post_hashtags ph where ph.hashtag_id=h.id),0),follower_count=coalesce((select count(*) from public.hashtag_follows hf where hf.hashtag_id=h.id),0);
end $$;

create or replace function public.set_follow_state(p_following_id uuid,p_follow boolean) returns jsonb language plpgsql security invoker set search_path=public as $$
declare me uuid:=(select auth.uid()); protected boolean:=false; s text; begin
 if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_following_id is null or p_following_id=me then raise exception 'Invalid follow target' using errcode='22023'; end if;
 select coalesce(protected_account,false) into protected from public.profiles where id=p_following_id;
 if not found then raise exception 'Profile not found' using errcode='P0002'; end if;
 if p_follow then s:=case when protected then 'pending' else 'accepted' end; insert into public.follows(follower_id,following_id,status,accepted_at) values(me,p_following_id,s,case when s='accepted' then now() else null end) on conflict(follower_id,following_id) do update set status=excluded.status,accepted_at=excluded.accepted_at;
 else delete from public.follows where follower_id=me and following_id=p_following_id; end if;
 select status into s from public.follows where follower_id=me and following_id=p_following_id;
 return jsonb_build_object('following',s='accepted','requested',s='pending','status',coalesce(s,'none'),'following_id',p_following_id);
end $$;

create or replace function public.get_follow_state(p_following_id uuid) returns jsonb language sql security invoker set search_path=public as $$
select jsonb_build_object('following',coalesce((select f.status='accepted' from public.follows f where f.follower_id=(select auth.uid()) and f.following_id=p_following_id),false),'requested',coalesce((select f.status='pending' from public.follows f where f.follower_id=(select auth.uid()) and f.following_id=p_following_id),false),'followed_by',coalesce((select f.status='accepted' from public.follows f where f.follower_id=p_following_id and f.following_id=(select auth.uid())),false),'status',coalesce((select f.status from public.follows f where f.follower_id=(select auth.uid()) and f.following_id=p_following_id),'none')); $$;

create or replace function public.enforce_follow_protection() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='accepted' and coalesce((select protected_account from public.profiles where id=new.following_id),false) then new.status:='pending'; new.accepted_at:=null; end if;
 return new;
end; $$;
drop trigger if exists follows_enforce_protection on public.follows;
create trigger follows_enforce_protection before insert or update on public.follows for each row execute function public.enforce_follow_protection();

create or replace function public.sync_follow_counters() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.profiles p set follower_count=coalesce((select count(*) from public.follows f where f.following_id=p.id and f.status='accepted'),0) where p.id=coalesce(new.following_id,old.following_id);
 update public.profiles p set following_count=coalesce((select count(*) from public.follows f where f.follower_id=p.id and f.status='accepted'),0) where p.id=coalesce(new.follower_id,old.follower_id);
 return coalesce(new,old);
end; $$;
drop trigger if exists follows_sync_profile_counters on public.follows;
create trigger follows_sync_profile_counters after insert or update or delete on public.follows for each row execute function public.sync_follow_counters();

create or replace function public.sync_hashtag_follow_count() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.hashtags h set follower_count=coalesce((select count(*) from public.hashtag_follows hf where hf.hashtag_id=h.id),0) where h.id=coalesce(new.hashtag_id,old.hashtag_id);
 return coalesce(new,old);
end; $$;
drop trigger if exists hashtag_follows_sync_count on public.hashtag_follows;
create trigger hashtag_follows_sync_count after insert or update or delete on public.hashtag_follows for each row execute function public.sync_hashtag_follow_count();

create or replace function public.search_everything_by_type(p_query text,p_limit integer default 40,p_type text default 'all')
returns table(kind text,id text,score real,title text,subtitle text,content text,url text,source text,created_at timestamptz,actor_uri text)
language sql security definer set search_path=public as $$
select r.* from public.search_everything(p_query,least(greatest(coalesce(p_limit,40),1),80)) r
where lower(coalesce(p_type,'all'))='all'
 or (lower(p_type)='users' and r.kind in ('user','fediverse_user'))
 or (lower(p_type)='posts' and r.kind in ('post','fediverse_post'))
 or (lower(p_type)='hashtags' and r.kind='hashtag')
 or (lower(p_type)='instances' and r.kind='instance')
 or (lower(p_type)='communities' and r.kind='community')
 or (lower(p_type)='products' and r.kind='product')
 or (lower(p_type)='fediverse_users' and r.kind='fediverse_user')
 or (lower(p_type)='fediverse_posts' and r.kind='fediverse_post')
order by r.score desc,r.created_at desc nulls last
limit least(greatest(coalesce(p_limit,40),1),80);
$$;

alter table public.follows enable row level security;
alter table public.hashtag_follows enable row level security;
drop policy if exists follows_select_own on public.follows; create policy follows_select_own on public.follows for select to authenticated using ((select auth.uid())=follower_id or (select auth.uid())=following_id);
drop policy if exists follows_insert_own on public.follows; create policy follows_insert_own on public.follows for insert to authenticated with check ((select auth.uid())=follower_id and follower_id<>following_id);
drop policy if exists follows_delete_own on public.follows; create policy follows_delete_own on public.follows for delete to authenticated using ((select auth.uid())=follower_id);
drop policy if exists hashtag_follows_select_own on public.hashtag_follows; create policy hashtag_follows_select_own on public.hashtag_follows for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists hashtag_follows_insert_own on public.hashtag_follows; create policy hashtag_follows_insert_own on public.hashtag_follows for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists hashtag_follows_delete_own on public.hashtag_follows; create policy hashtag_follows_delete_own on public.hashtag_follows for delete to authenticated using ((select auth.uid())=user_id);

revoke all on function public.search_everything_by_type(text,integer,text) from public;
revoke all on function public.enforce_follow_protection() from public;
revoke all on function public.sync_follow_counters() from public;
revoke all on function public.sync_hashtag_follow_count() from public;
grant execute on function public.set_follow_state(uuid,boolean) to authenticated;
grant execute on function public.get_follow_state(uuid) to authenticated;
grant execute on function public.search_everything_by_type(text,integer,text) to authenticated;
grant execute on function public.get_unified_hashtag_feed(text,integer) to authenticated;
