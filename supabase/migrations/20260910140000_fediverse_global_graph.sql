begin;

create or replace view public.federated_followers as
select
  fr.id,
  fr.local_user_id,
  fr.remote_actor_url,
  fr.relationship,
  fr.state,
  fra.acct,
  fra.username,
  fra.domain,
  fra.actor,
  fr.created_at,
  fr.updated_at
from public.federation_relationships fr
left join public.federation_remote_actors fra on fra.actor_url = fr.remote_actor_url
where fr.relationship = 'follower'
  and fr.local_user_id = auth.uid();

create or replace view public.federated_following as
select
  fr.id,
  fr.local_user_id,
  fr.remote_actor_url,
  fr.relationship,
  fr.state,
  fra.acct,
  fra.username,
  fra.domain,
  fra.actor,
  fr.created_at,
  fr.updated_at
from public.federation_relationships fr
left join public.federation_remote_actors fra on fra.actor_url = fr.remote_actor_url
where fr.relationship in ('pending','accepted','following')
  and fr.local_user_id = auth.uid();

grant select on public.federated_followers to authenticated;
grant select on public.federated_following to authenticated;

commit;
