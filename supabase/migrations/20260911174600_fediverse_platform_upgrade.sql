-- Fediverse platform upgrade: durable delivery observability, queue indexes,
-- and idempotency protection for remote interactions.
-- Safe to re-run on environments that already received the SQL directly.

create unique index if not exists federation_remote_interactions_active_uq
  on public.federation_remote_interactions(local_user_id, object_url, interaction_type)
  where status <> 'undone';

create index if not exists federation_outbox_due_idx
  on public.federation_outbox(status, next_attempt_at, created_at);

create index if not exists federation_deliveries_due_idx
  on public.federation_deliveries(status, next_attempt_at, created_at);

create index if not exists federation_remote_interactions_pending_idx
  on public.federation_remote_interactions(status, updated_at);

create table if not exists public.federation_delivery_events (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid references public.federation_outbox(id) on delete cascade,
  delivery_id uuid references public.federation_deliveries(id) on delete cascade,
  interaction_id uuid references public.federation_remote_interactions(id) on delete cascade,
  activity_id text,
  event_type text not null check(event_type in ('attempt','delivered','retry','dead','rejected','duplicate')),
  http_status integer,
  error text,
  response_body text,
  attempt_number integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists federation_delivery_events_activity_idx
  on public.federation_delivery_events(activity_id, created_at desc);

create index if not exists federation_delivery_events_created_idx
  on public.federation_delivery_events(created_at desc);

alter table public.federation_delivery_events enable row level security;
revoke all on public.federation_delivery_events from anon, authenticated;
