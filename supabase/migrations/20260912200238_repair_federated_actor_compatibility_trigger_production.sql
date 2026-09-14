-- Production-history mirror for migration 20260912022000.
-- The trigger repair was already applied under Supabase-generated version
-- 20260912200238. Keep the exact production version represented in source.
create or replace function public.sync_federated_actor_compatibility() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.uri is null or new.uri='' then new.uri:=new.actor_url; end if;
  if new.public_key_id is null and new.actor_url is not null then new.public_key_id:=new.actor_url||'#main-key'; end if;
  if new.inbox_url is null and new.actor_url is not null then new.inbox_url:=new.actor_url||'/inbox'; end if;
  if new.outbox_url is null and new.actor_url is not null then new.outbox_url:=new.actor_url||'/outbox'; end if;
  if new.followers_url is null and new.actor_url is not null then new.followers_url:=new.actor_url||'/followers'; end if;
  if new.following_url is null and new.actor_url is not null then new.following_url:=new.actor_url||'/following'; end if;
  if new.raw_actor is null or new.raw_actor='{}'::jsonb then
    new.raw_actor:=jsonb_build_object('@context',jsonb_build_array('https://www.w3.org/ns/activitystreams','https://w3id.org/security/v1'),'id',new.actor_url,'type',coalesce(new.actor_type,'Person'),'preferredUsername',coalesce(new.username,new.preferred_username),'inbox',new.inbox_url,'outbox',new.outbox_url,'followers',new.followers_url,'following',new.following_url,'publicKey',jsonb_build_object('id',coalesce(new.public_key_id,new.actor_url||'#main-key'),'owner',new.actor_url,'publicKeyPem',new.public_key_pem));
  end if;
  new.updated_at:=coalesce(new.updated_at,now());
  return new;
end $$;
revoke execute on function public.sync_federated_actor_compatibility() from public,anon,authenticated;
grant execute on function public.sync_federated_actor_compatibility() to service_role;
drop trigger if exists federated_actor_compatibility on public.federated_actors;
create trigger federated_actor_compatibility before insert or update on public.federated_actors for each row execute function public.sync_federated_actor_compatibility();
