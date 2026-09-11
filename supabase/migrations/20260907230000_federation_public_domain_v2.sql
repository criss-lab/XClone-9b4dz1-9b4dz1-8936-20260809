create or replace function public.normalize_federation_actor_public_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  origin constant text := 'https://federation.testagram.site';
  canonical text;
begin
  if new.username is not null then
    canonical := origin || '/users/' || regexp_replace(lower(new.username), '[^a-z0-9_-]', '_', 'g');
    new.actor_url := canonical;
    new.inbox_url := canonical || '/inbox';
  end if;
  return new;
end;
$$;
drop trigger if exists federation_actors_public_domain on public.federation_actors;
create trigger federation_actors_public_domain
before insert or update of username, actor_url, inbox_url on public.federation_actors
for each row execute function public.normalize_federation_actor_public_domain();
update public.federation_actors
set actor_url = 'https://federation.testagram.site/users/' || regexp_replace(lower(username), '[^a-z0-9_-]', '_', 'g'),
    inbox_url = 'https://federation.testagram.site/users/' || regexp_replace(lower(username), '[^a-z0-9_-]', '_', 'g') || '/inbox';
