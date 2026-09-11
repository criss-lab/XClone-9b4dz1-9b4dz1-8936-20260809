begin;

-- One canonical hashtag namespace is shared by native posts and ActivityPub objects.
-- The existing hashtags table is already lowercase by constraint and unique by tag.
create unique index if not exists hashtags_tag_lower_key on public.hashtags (lower(tag));

create table if not exists public.federated_object_hashtags (
  object_id uuid not null references public.federated_objects(id) on delete cascade,
  hashtag_id uuid not null references public.hashtags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (object_id, hashtag_id)
);
create index if not exists federated_object_hashtags_hashtag_idx on public.federated_object_hashtags (hashtag_id, object_id);
create index if not exists federated_object_hashtags_object_idx on public.federated_object_hashtags (object_id, hashtag_id);

-- Normalize ActivityPub tag objects/strings into the native hashtag registry.
create or replace function public.sync_federated_object_hashtags(p_object_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare obj jsonb; raw_tag text; normalized text; hid uuid;
begin
  select tags into obj from public.federated_objects where id=p_object_id;
  if not found then return; end if;
  delete from public.federated_object_hashtags where object_id=p_object_id;
  if jsonb_typeof(coalesce(obj,'[]'::jsonb)) <> 'array' then return; end if;
  for raw_tag in
    select nullif(trim(coalesce(x->>'name',x->>'tag',case when jsonb_typeof(x)='string' then trim(both '"' from x::text) end)),'')
    from jsonb_array_elements(obj) as t(x)
  loop
    normalized:=lower(regexp_replace(raw_tag,'^#+',''));
    normalized:=regexp_replace(normalized,'[^[:alnum:]_\-]','','g');
    if normalized='' or length(normalized)>100 then continue; end if;
    insert into public.hashtags(tag,post_count,last_used_at) values(normalized,0,now())
      on conflict(tag) do update set last_used_at=greatest(public.hashtags.last_used_at,excluded.last_used_at)
      returning id into hid;
    insert into public.federated_object_hashtags(object_id,hashtag_id) values(p_object_id,hid) on conflict do nothing;
  end loop;
end; $$;

create or replace function public.trg_sync_federated_object_hashtags()
returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.sync_federated_object_hashtags(new.id); return new; end; $$;

drop trigger if exists federated_objects_sync_hashtags on public.federated_objects;
create trigger federated_objects_sync_hashtags after insert or update of tags on public.federated_objects
for each row execute function public.trg_sync_federated_object_hashtags();

do $$ declare r record; begin
  for r in select id from public.federated_objects where tags is not null loop perform public.sync_federated_object_hashtags(r.id); end loop;
end; $$;

-- One hashtag page combines native and federated posts without exposing origin-specific logic to the client.
create or replace function public.get_unified_hashtag_feed(p_tag text,p_limit integer default 40)
returns table(kind text,id text,content text,url text,actor_uri text,created_at timestamptz,source text)
language sql security definer set search_path=public as $$
with q as (select lower(regexp_replace(trim(coalesce(p_tag,'')),'^#+','')) tag,least(greatest(coalesce(p_limit,40),1),80) lim),
native_posts as (
 select 'post'::text kind,p.id::text id,p.content,null::text url,null::text actor_uri,p.created_at,'testagram'::text source
 from public.post_hashtags ph join public.hashtags h on h.id=ph.hashtag_id join public.posts p on p.id=ph.post_id cross join q
 where h.tag=q.tag and p.visibility='public' and p.deleted_at is null
),fed_posts as (
 select 'fediverse_post'::text kind,o.id::text id,o.content,coalesce(o.url,o.uri),o.actor_uri,coalesce(o.published_at,o.created_at),'fediverse'::text
 from public.federated_object_hashtags f join public.hashtags h on h.id=f.hashtag_id join public.federated_objects o on o.id=f.object_id cross join q
 where h.tag=q.tag and not o.sensitive and o.deleted_at is null
)
select * from native_posts union all select * from fed_posts order by created_at desc nulls last limit (select lim from q);
$$;

revoke all on function public.sync_federated_object_hashtags(uuid) from public;
revoke all on function public.trg_sync_federated_object_hashtags() from public;
revoke all on function public.get_unified_hashtag_feed(text,integer) from public;
grant execute on function public.get_unified_hashtag_feed(text,integer) to authenticated;

commit;
