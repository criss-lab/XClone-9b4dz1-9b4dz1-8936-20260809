-- Hardening follow counters, hashtag counters and a small compatibility correction.

create or replace function public.refresh_social_follow_counts()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if tg_op <> 'INSERT' then
    update public.profiles set follower_count=(select count(*) from public.follows where following_id=old.following_id and status='accepted'), following_count=(select count(*) from public.follows where follower_id=old.follower_id and status='accepted') where id in (old.follower_id,old.following_id);
  end if;
  if tg_op <> 'DELETE' then
    update public.profiles set follower_count=(select count(*) from public.follows where following_id=new.following_id and status='accepted'), following_count=(select count(*) from public.follows where follower_id=new.follower_id and status='accepted') where id in (new.follower_id,new.following_id);
  end if;
  return coalesce(new,old);
end $$;
drop trigger if exists follows_refresh_profile_counts on public.follows;
create trigger follows_refresh_profile_counts after insert or update or delete on public.follows for each row execute function public.refresh_social_follow_counts();

create or replace function public.refresh_hashtag_follow_count()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if tg_op <> 'INSERT' then update public.hashtags set follower_count=(select count(*) from public.hashtag_follows where hashtag_id=old.hashtag_id) where id=old.hashtag_id; end if;
  if tg_op <> 'DELETE' then update public.hashtags set follower_count=(select count(*) from public.hashtag_follows where hashtag_id=new.hashtag_id) where id=new.hashtag_id; end if;
  return coalesce(new,old);
end $$;
drop trigger if exists hashtag_follows_refresh_count on public.hashtag_follows;
create trigger hashtag_follows_refresh_count after insert or update or delete on public.hashtag_follows for each row execute function public.refresh_hashtag_follow_count();

update public.hashtags h set follower_count=(select count(*) from public.hashtag_follows hf where hf.hashtag_id=h.id), usage_count=coalesce((select count(*) from public.post_hashtags ph where ph.hashtag_id=h.id),0), post_count=coalesce((select count(*) from public.post_hashtags ph where ph.hashtag_id=h.id),0);
update public.profiles p set follower_count=(select count(*) from public.follows f where f.following_id=p.id and f.status='accepted'), following_count=(select count(*) from public.follows f where f.follower_id=p.id and f.status='accepted');

-- Correct the remote actor domain extraction and keep the RPC stable for the client.
create or replace function public.search_everything(p_query text,p_limit integer default 40,p_type text default 'all')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare q text:=lower(trim(coalesce(p_query,''))); lim integer:=least(greatest(coalesce(p_limit,40),1),80); r jsonb:='[]'::jsonb; x jsonb; begin
  if q='' then return r; end if;
  if p_type in ('all','users') then select coalesce(jsonb_agg(jsonb_build_object('result_type','user','id',p.id,'username',p.username,'display_name',p.display_name,'bio',p.bio,'avatar_url',p.avatar_url,'verified',coalesce((to_jsonb(p)->>'verified')::boolean,false),'followers_count',coalesce(p.follower_count,0),'source','native','url','/profile/'||p.username)),'[]'::jsonb) into x from (select * from public.profiles where lower(coalesce(username,'')) like '%'||q||'%' or lower(coalesce(display_name,'')) like '%'||q||'%' or lower(coalesce(bio,'')) like '%'||q||'%' order by case when lower(username)=q then 0 when lower(username) like q||'%' then 1 else 2 end,coalesce(follower_count,0) desc limit lim) p; r:=r||x; end if;
  if p_type in ('all','hashtags') then select coalesce(jsonb_agg(jsonb_build_object('result_type','hashtag','id',h.id,'tag',h.tag,'usage_count',coalesce(h.usage_count,h.post_count,0),'follower_count',coalesce(h.follower_count,0),'source','native','url','/hashtag/'||h.tag)),'[]'::jsonb) into x from (select * from public.hashtags where lower(tag) like '%'||replace(q,'#','')||'%' order by coalesce(usage_count,post_count,0) desc limit lim) h; r:=r||x; end if;
  if p_type in ('all','posts') then select coalesce(jsonb_agg(jsonb_build_object('result_type','post','id',p.id,'content',coalesce(p.content,p.body,''),'created_at',p.created_at,'author_id',p.author_id,'source','native','url','/post/'||p.id)),'[]'::jsonb) into x from (select * from public.posts where lower(coalesce(content,body,'')) like '%'||q||'%' order by created_at desc limit lim) p; r:=r||x; end if;
  if p_type in ('all','communities') then select coalesce(jsonb_agg(jsonb_build_object('result_type','community','id',c.id,'name',c.name,'display_name',coalesce(to_jsonb(c)->>'display_name',c.name),'description',c.description,'member_count',c.member_count,'source','native','url','/c/'||c.name)),'[]'::jsonb) into x from (select * from public.communities where lower(name) like '%'||q||'%' or lower(coalesce(description,'')) like '%'||q||'%' order by member_count desc limit lim) c; r:=r||x; end if;
  if p_type in ('all','products') then select coalesce(jsonb_agg(jsonb_build_object('result_type','product','id',p.id,'name',p.name,'description',p.description,'image_url',p.image_url,'price_cents',p.price_cents,'source','native')),'[]'::jsonb) into x from (select * from public.products where lower(name) like '%'||q||'%' or lower(coalesce(description,'')) like '%'||q||'%' order by created_at desc limit lim) p; r:=r||x; end if;
  if p_type in ('all','fediverse_users') then select coalesce(jsonb_agg(jsonb_build_object('result_type','fediverse_user','id',a.id,'actor_url',coalesce(a.actor_url,a.uri),'username',coalesce(a.username,a.raw_actor->>'preferredUsername'),'display_name',coalesce(a.raw_actor->>'name',a.username),'domain',split_part(regexp_replace(coalesce(a.actor_url,a.uri),'^https?://',''),'/',1),'avatar_url',a.raw_actor->'icon'->>'url','source','fediverse')),'[]'::jsonb) into x from (select * from public.federated_actors where lower(coalesce(username,'')) like '%'||replace(q,'@','')||'%' or lower(coalesce(actor_url,uri,'')) like '%'||q||'%' or lower(coalesce(raw_actor->>'name','')) like '%'||q||'%' limit lim) a; r:=r||x; end if;
  if p_type in ('all','fediverse_posts') then select coalesce(jsonb_agg(jsonb_build_object('result_type','fediverse_post','id',o.id,'uri',o.uri,'url',coalesce(o.url,o.uri),'content',coalesce(o.content,''),'published_at',o.published_at,'actor_uri',o.actor_uri,'source','fediverse','_is_federated',true)),'[]'::jsonb) into x from (select * from public.federated_objects where object_type='Note' and deleted_at is null and lower(coalesce(content,'')) like '%'||q||'%' order by published_at desc limit lim) o; r:=r||x; end if;
  return r;
end $$;
grant execute on function public.search_everything(text,integer,text) to authenticated;
