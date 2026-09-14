create table if not exists public.federation_actor_provisioning_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null default 'profile_created',
  attempts integer not null default 0,
  last_error text,
  queued_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists federation_actor_provisioning_queue_pending_idx
  on public.federation_actor_provisioning_queue (processed_at, queued_at);

alter table public.federation_actor_provisioning_queue enable row level security;
revoke all on public.federation_actor_provisioning_queue from anon, authenticated;
drop policy if exists federation_actor_provisioning_queue_service_only on public.federation_actor_provisioning_queue;
create policy federation_actor_provisioning_queue_service_only
  on public.federation_actor_provisioning_queue
  for all to service_role using (true) with check (true);

create or replace function public.enqueue_federation_actor_provisioning()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is not null and new.username is not null and btrim(new.username) <> '' then
    insert into public.federation_actor_provisioning_queue(user_id, reason, queued_at, processed_at)
    values (new.id, case when tg_op = 'INSERT' then 'profile_created' else 'profile_changed' end, now(), null)
    on conflict (user_id) do update
      set reason = excluded.reason,
          queued_at = excluded.queued_at,
          processed_at = null,
          last_error = null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enqueue_federation_actor on public.profiles;
create trigger profiles_enqueue_federation_actor
after insert or update of username, display_name, avatar_url, bio, cover_url, website, location, protected_account
on public.profiles
for each row execute function public.enqueue_federation_actor_provisioning();

insert into public.federation_actor_provisioning_queue(user_id, reason)
select p.id, 'reconciliation_backfill'
from public.profiles p
left join public.federation_actors a on a.user_id = p.id
where p.username is not null and a.user_id is null
on conflict (user_id) do update
set reason = excluded.reason, processed_at = null, queued_at = now();

create or replace view public.federation_actor_reconciliation as
select
  (select count(*) from public.profiles where username is not null) as profile_count,
  (select count(*) from public.federation_actors) as actor_count,
  (select count(*) from public.federation_actors where public_key_pem is not null and private_key_jwk is not null) as keyed_actor_count,
  (select count(*) from public.profiles p left join public.federation_actors a on a.user_id = p.id where p.username is not null and a.user_id is null) as missing_actor_count,
  (select count(*) from public.federation_actor_provisioning_queue where processed_at is null) as pending_queue_count;
