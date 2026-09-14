create or replace function public.enqueue_federation_actor_provisioning()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.federation_actor_provisioning_queue(user_id, reason, attempts, last_error, queued_at, processed_at)
  values (new.id, 'profile_created', 0, null, now(), null)
  on conflict (user_id) do update set
    reason = excluded.reason,
    queued_at = now(),
    processed_at = null,
    last_error = null;
  return new;
end;
$$;

revoke all on function public.enqueue_federation_actor_provisioning() from public;

drop trigger if exists trg_enqueue_federation_actor_provisioning on public.profiles;
create trigger trg_enqueue_federation_actor_provisioning
after insert on public.profiles
for each row execute function public.enqueue_federation_actor_provisioning();

insert into public.federation_actor_provisioning_queue(user_id, reason, attempts, last_error, queued_at, processed_at)
select p.id, 'reconciliation_backfill', 0, null, now(), null
from public.profiles p
left join public.federation_actors a on a.user_id = p.id
where a.user_id is null
on conflict (user_id) do update set
  reason = 'reconciliation_backfill',
  queued_at = now(),
  processed_at = null,
  last_error = null;
