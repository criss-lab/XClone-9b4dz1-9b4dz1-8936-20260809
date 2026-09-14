-- Reconstitute the federation quote-authorization and interaction-status state that
-- was previously applied remotely but is no longer present in the checked-in history.
-- This migration is intentionally idempotent so production can converge safely.

alter table public.federation_remote_quotes
  add column if not exists quote_request_activity_uri text,
  add column if not exists quote_authorization_uri text,
  add column if not exists quote_status text,
  add column if not exists quote_authorization jsonb,
  add column if not exists revoked_at timestamptz;

update public.federation_remote_quotes
set quote_status = case
  when quote_status is null and status = 'sent' then 'accepted'
  when quote_status is null and status = 'failed' then 'failed'
  when quote_status is null and status = 'undone' then 'revoked'
  when quote_status is null then 'pending'
  else quote_status
end
where quote_status is null;

alter table public.federation_remote_quotes
  alter column quote_status set default 'pending',
  alter column quote_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.federation_remote_quotes'::regclass
      and conname = 'federation_remote_quotes_quote_status_check'
  ) then
    alter table public.federation_remote_quotes
      add constraint federation_remote_quotes_quote_status_check
      check (quote_status in ('legacy','pending','accepted','rejected','revoked','failed'));
  end if;
end
$$;

create index if not exists federation_remote_quotes_request_idx
  on public.federation_remote_quotes (quote_request_activity_uri)
  where quote_request_activity_uri is not null;

create index if not exists federation_remote_quotes_auth_idx
  on public.federation_remote_quotes (quote_authorization_uri)
  where quote_authorization_uri is not null;

create or replace function public.sync_federation_remote_interaction_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.federated_object_interactions
  set active = (new.status = 'sent'), updated_at = now()
  where activity_uri = new.activity_uri;
  return new;
end;
$$;

drop trigger if exists federation_remote_interaction_status_projection
  on public.federation_remote_interactions;

create trigger federation_remote_interaction_status_projection
after insert or update of status, activity_uri
on public.federation_remote_interactions
for each row
execute function public.sync_federation_remote_interaction_status();

notify pgrst, 'reload schema';
