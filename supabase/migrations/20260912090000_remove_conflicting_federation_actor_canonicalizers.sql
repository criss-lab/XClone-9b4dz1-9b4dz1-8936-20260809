-- Keep one canonical ActivityPub origin for local actors.
-- Older deployments installed competing BEFORE triggers that rewrote actor URLs
-- to api.testagram.site and a workers.dev hostname. Those rewrites made identity nondeterministic.

drop trigger if exists federation_actor_https_urls on public.federation_actors;
drop trigger if exists federation_actors_public_domain on public.federation_actors;
drop trigger if exists zz_federation_actor_workersdev_canonical on public.federation_actors;
drop trigger if exists zz_federation_canonical_origin on public.federation_actors;

create or replace function public.federation_canonicalize_actor_url()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.username is null or btrim(new.username) = '' then
    raise exception 'federation_actor_username_required';
  end if;
  new.actor_url := 'https://federation.testagram.site/users/' || new.username;
  new.inbox_url := new.actor_url || '/inbox';
  return new;
end;
$$;

create trigger zz_federation_canonical_origin
before insert or update of username, actor_url, inbox_url
on public.federation_actors
for each row execute function public.federation_canonicalize_actor_url();

update public.federation_actors
set actor_url = 'https://federation.testagram.site/users/' || username,
    inbox_url = 'https://federation.testagram.site/users/' || username || '/inbox',
    updated_at = now();
