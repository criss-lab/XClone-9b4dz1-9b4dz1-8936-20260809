create or replace function public.normalize_federation_actor_urls()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.actor_url is not null then
    new.actor_url := regexp_replace(new.actor_url, '^http://', 'https://');
  end if;
  if new.inbox_url is not null then
    new.inbox_url := regexp_replace(new.inbox_url, '^http://', 'https://');
  end if;
  return new;
end;
$$;

drop trigger if exists federation_actor_https_urls on public.federation_actors;
create trigger federation_actor_https_urls
before insert or update of actor_url, inbox_url
on public.federation_actors
for each row
execute function public.normalize_federation_actor_urls();

update public.federation_actors
set actor_url = regexp_replace(actor_url, '^http://', 'https://'),
    inbox_url = regexp_replace(inbox_url, '^http://', 'https://')
where actor_url like 'http://%' or inbox_url like 'http://%';
