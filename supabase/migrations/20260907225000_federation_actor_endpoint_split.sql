create or replace function public.normalize_federation_actor_urls()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  host text;
  username text;
begin
  if new.actor_url is not null then
    new.actor_url := regexp_replace(new.actor_url, '^http://', 'https://');
    host := (regexp_match(new.actor_url, '^https://([^/]+)'))[1];
    username := (regexp_match(new.actor_url, '/users/([^/?#]+)'))[1];
    if host is not null and username is not null then
      new.actor_url := format('https://%s/functions/v1/activitypub-actor/users/%s', host, username);
    end if;
  end if;
  if new.inbox_url is not null then
    new.inbox_url := regexp_replace(new.inbox_url, '^http://', 'https://');
    host := (regexp_match(new.inbox_url, '^https://([^/]+)'))[1];
    username := (regexp_match(new.inbox_url, '/users/([^/?#]+)'))[1];
    if host is not null and username is not null then
      new.inbox_url := format('https://%s/functions/v1/gateway-relay/users/%s/inbox', host, username);
    end if;
  end if;
  return new;
end;
$$;
update public.federation_actors
set actor_url = format('https://%s/functions/v1/activitypub-actor/users/%s', (regexp_match(regexp_replace(actor_url, '^http://', 'https://'), '^https://([^/]+)'))[1], (regexp_match(actor_url, '/users/([^/?#]+)'))[1]),
    inbox_url = format('https://%s/functions/v1/gateway-relay/users/%s/inbox', (regexp_match(regexp_replace(inbox_url, '^http://', 'https://'), '^https://([^/]+)'))[1], (regexp_match(inbox_url, '/users/([^/?#]+)'))[1])
where actor_url is not null and inbox_url is not null;
