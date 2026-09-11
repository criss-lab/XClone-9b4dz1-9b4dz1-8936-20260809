create or replace function public.normalize_federation_actor_urls()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.actor_url is not null then
    new.actor_url := regexp_replace(new.actor_url, '^http://', 'https://');
    if new.actor_url ~ '^https://[^/]+/users/' then
      new.actor_url := regexp_replace(new.actor_url, '^https://([^/]+)/users/', 'https://\1/functions/v1/gateway-relay/users/');
    end if;
  end if;
  if new.inbox_url is not null then
    new.inbox_url := regexp_replace(new.inbox_url, '^http://', 'https://');
    if new.inbox_url ~ '^https://[^/]+/users/' then
      new.inbox_url := regexp_replace(new.inbox_url, '^https://([^/]+)/users/', 'https://\1/functions/v1/gateway-relay/users/');
    end if;
  end if;
  return new;
end;
$$;
update public.federation_actors
set actor_url = regexp_replace(regexp_replace(actor_url, '^http://', 'https://'), '^https://([^/]+)/users/', 'https://\\1/functions/v1/gateway-relay/users/'),
    inbox_url = regexp_replace(regexp_replace(inbox_url, '^http://', 'https://'), '^https://([^/]+)/users/', 'https://\\1/functions/v1/gateway-relay/users/')
where actor_url ~ '^https?://[^/]+/users/' or inbox_url ~ '^https?://[^/]+/users/';
