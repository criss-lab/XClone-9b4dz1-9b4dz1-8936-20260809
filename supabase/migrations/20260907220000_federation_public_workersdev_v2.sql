-- Canonical public ActivityPub identity for the globally reachable federation Worker.
-- This intentionally overrides the earlier branded-domain migration until the
-- branded hostname is routed directly to the federation Worker at the edge.
create or replace function public.federation_actor_workersdev_canonical()
returns trigger
language plpgsql
as $$
begin
  if new.actor_url is not null then
    new.actor_url := 'https://testagram-api.nahashonnyaga794.workers.dev/users/' || new.username;
  end if;
  if new.inbox_url is not null then
    new.inbox_url := new.actor_url || '/inbox';
  end if;
  return new;
end;
$$;

drop trigger if exists zz_federation_actor_workersdev_canonical on public.federation_actors;
create trigger zz_federation_actor_workersdev_canonical
before insert or update of username, actor_url, inbox_url
on public.federation_actors
for each row execute function public.federation_actor_workersdev_canonical();

update public.federation_actors
set actor_url = 'https://testagram-api.nahashonnyaga794.workers.dev/users/' || username,
    inbox_url = 'https://testagram-api.nahashonnyaga794.workers.dev/users/' || username || '/inbox';
