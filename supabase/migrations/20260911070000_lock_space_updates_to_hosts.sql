begin;

-- Participants may join/leave through the participant table and the
-- server-side count trigger, but they must never PATCH the host-owned Space.
-- Listener counts are derived by the space_participant_count_trigger, so the
-- browser does not need update access to public.spaces.
drop policy if exists spaces_host_update on public.spaces;

create policy spaces_host_update on public.spaces
  for update to authenticated
  using (host_id = (select auth.uid()))
  with check (host_id = (select auth.uid()));

commit;
