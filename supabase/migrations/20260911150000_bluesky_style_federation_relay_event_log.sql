create table if not exists public.federation_relay_events (
  seq bigint generated always as identity primary key,
  activity_id text,
  activity_type text not null,
  actor_url text,
  object_uri text,
  direction text not null check (direction in ('inbound','outbound')),
  source_table text not null check (source_table in ('federation_inbox','federation_outbound_activities')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists federation_relay_events_seq_idx on public.federation_relay_events (seq);
create index if not exists federation_relay_events_created_idx on public.federation_relay_events (created_at, seq);
create index if not exists federation_relay_events_actor_idx on public.federation_relay_events (actor_url, seq);

create unique index if not exists federation_relay_events_activity_uidx
  on public.federation_relay_events (direction, activity_id)
  where activity_id is not null;

create or replace function public.capture_federation_inbox_to_relay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.federation_relay_events
    (activity_id, activity_type, actor_url, object_uri, direction, source_table, payload, created_at)
  values
    (new.activity_id, new.activity_type, new.actor_url, new.payload->>'object', 'inbound', 'federation_inbox', new.payload, coalesce(new.received_at, now()))
  on conflict (direction, activity_id) where activity_id is not null do nothing;
  return new;
end;
$$;

create or replace function public.capture_federation_outbound_to_relay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.federation_relay_events
    (activity_id, activity_type, actor_url, object_uri, direction, source_table, payload, created_at)
  values
    (new.activity_uri, new.activity_type, new.actor_uri, new.object_uri, 'outbound', 'federation_outbound_activities', new.payload, new.created_at)
  on conflict (direction, activity_id) where activity_id is not null do nothing;
  return new;
end;
$$;

drop trigger if exists federation_inbox_relay_event on public.federation_inbox;
create trigger federation_inbox_relay_event
after insert on public.federation_inbox
for each row execute function public.capture_federation_inbox_to_relay();

drop trigger if exists federation_outbound_relay_event on public.federation_outbound_activities;
create trigger federation_outbound_relay_event
after insert on public.federation_outbound_activities
for each row execute function public.capture_federation_outbound_to_relay();

insert into public.federation_relay_events
  (activity_id, activity_type, actor_url, object_uri, direction, source_table, payload, created_at)
select activity_id, activity_type, actor_url, payload->>'object', 'inbound', 'federation_inbox', payload, received_at
from public.federation_inbox
on conflict (direction, activity_id) where activity_id is not null do nothing;

alter table public.federation_relay_events enable row level security;
drop policy if exists federation_relay_events_public_read on public.federation_relay_events;
create policy federation_relay_events_public_read
on public.federation_relay_events
for select
using (true);
