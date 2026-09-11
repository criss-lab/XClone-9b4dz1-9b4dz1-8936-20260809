create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('welcome','security','notification')),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  name text,
  subject text,
  message text,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  resend_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists email_events_status_created_idx on public.email_events(status, created_at);
create index if not exists email_events_user_created_idx on public.email_events(user_id, created_at desc);

alter table public.email_events enable row level security;
revoke all on public.email_events from anon, authenticated;

drop policy if exists "email_events_no_client_access" on public.email_events;
;
