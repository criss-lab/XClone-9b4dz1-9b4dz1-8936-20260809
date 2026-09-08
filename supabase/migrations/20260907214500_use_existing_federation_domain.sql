create or replace function public.federation_canonicalize_actor_url() returns trigger language plpgsql as $$ begin new.actor_url := 'https://federation.testagram.site/users/' || new.username; new.inbox_url := new.actor_url || '/inbox'; return new; end; $$;

update public.federation_actors
set actor_url='https://federation.testagram.site/users/' || username,
    inbox_url='https://federation.testagram.site/users/' || username || '/inbox';
