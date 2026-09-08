create or replace function public.federation_canonicalize_actor_url() returns trigger language plpgsql as $$ begin new.actor_url := 'https://fedi.testagram.site/users/' || new.username; new.inbox_url := new.actor_url || '/inbox'; return new; end; $$;

drop trigger if exists zz_federation_canonical_origin on public.federation_actors;

create trigger zz_federation_canonical_origin
before insert or update of username, actor_url, inbox_url on public.federation_actors
for each row execute function public.federation_canonicalize_actor_url();

update public.federation_actors
set actor_url='https://fedi.testagram.site/users/' || username,
    inbox_url='https://fedi.testagram.site/users/' || username || '/inbox';
