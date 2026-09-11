begin;

-- Restored source-of-truth migration for objects already present in production.
-- The remote migration history contains version 20260909144204, so this file
-- intentionally recreates the same schema for fresh environments/resets.

create table if not exists public.community_events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) >= 3 and char_length(title) <= 140),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_events_community_starts_idx
  on public.community_events(community_id, starts_at);

alter table public.community_events enable row level security;

drop policy if exists community_events_read on public.community_events;
drop policy if exists community_events_member_create on public.community_events;
drop policy if exists community_events_creator_update on public.community_events;
drop policy if exists community_events_creator_delete on public.community_events;

create policy community_events_read
  on public.community_events for select to authenticated
  using (
    exists (
      select 1 from public.communities c
      where c.id = community_events.community_id
        and (
          not c.is_private
          or exists (
            select 1 from public.community_members m
            where m.community_id = c.id and m.user_id = auth.uid()
          )
        )
    )
  );

create policy community_events_member_create
  on public.community_events for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.community_members m
      where m.community_id = community_events.community_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy community_events_creator_update
  on public.community_events for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy community_events_creator_delete
  on public.community_events for delete to authenticated
  using (created_by = auth.uid());

create table if not exists public.space_speaker_requests (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, user_id)
);

create index if not exists space_speaker_requests_queue_idx
  on public.space_speaker_requests(space_id, status, created_at);

alter table public.space_speaker_requests enable row level security;

drop policy if exists space_speaker_requests_read on public.space_speaker_requests;
drop policy if exists space_speaker_requests_create on public.space_speaker_requests;
drop policy if exists space_speaker_requests_update_host on public.space_speaker_requests;
drop policy if exists space_speaker_requests_cancel_self on public.space_speaker_requests;

create policy space_speaker_requests_read
  on public.space_speaker_requests for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.spaces s
      where s.id = space_speaker_requests.space_id
        and s.host_id = auth.uid()
    )
  );

create policy space_speaker_requests_create
  on public.space_speaker_requests for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.spaces s
      where s.id = space_speaker_requests.space_id and s.is_live = true
    )
  );

create policy space_speaker_requests_update_host
  on public.space_speaker_requests for update to authenticated
  using (
    exists (
      select 1 from public.spaces s
      where s.id = space_speaker_requests.space_id and s.host_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.spaces s
      where s.id = space_speaker_requests.space_id and s.host_id = auth.uid()
    )
  );

create policy space_speaker_requests_cancel_self
  on public.space_speaker_requests for delete to authenticated
  using (user_id = auth.uid());

create table if not exists public.space_reminders (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (space_id, user_id)
);

create index if not exists space_reminders_user_idx
  on public.space_reminders(user_id, created_at desc);

alter table public.space_reminders enable row level security;

drop policy if exists space_reminders_read_own on public.space_reminders;
drop policy if exists space_reminders_create_own on public.space_reminders;
drop policy if exists space_reminders_delete_own on public.space_reminders;

create policy space_reminders_read_own
  on public.space_reminders for select to authenticated
  using (user_id = auth.uid());

create policy space_reminders_create_own
  on public.space_reminders for insert to authenticated
  with check (user_id = auth.uid());

create policy space_reminders_delete_own
  on public.space_reminders for delete to authenticated
  using (user_id = auth.uid());

commit;
