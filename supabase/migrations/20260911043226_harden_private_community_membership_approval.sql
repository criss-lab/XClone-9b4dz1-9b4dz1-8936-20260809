begin;

-- Members may only self-insert as ordinary members. Elevated roles are
-- established by the owner-membership trigger or manager-only UPDATE policy.
drop policy if exists community_members_own on public.community_members;
drop policy if exists community_members_join_own on public.community_members;
create policy community_members_join_own on public.community_members
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'member'
  );

-- Preserve the intended private-community workflow: a self-join starts
-- pending, while an owner/moderator/admin can explicitly approve it.
create or replace function public.normalize_community_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_private boolean;
begin
  if new.role = 'owner' then
    new.status := 'active';
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'pending'
     and new.status = 'active'
     and public.can_manage_community(new.community_id) then
    return new;
  end if;

  select c.is_private into v_private
  from public.communities c
  where c.id = new.community_id;

  if coalesce(v_private, false) then
    new.status := 'pending';
  else
    new.status := 'active';
  end if;
  return new;
end;
$$;

create or replace function public.approve_community_member(
  p_community_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.can_manage_community(p_community_id) then
    raise exception 'Only community managers can approve members';
  end if;

  update public.community_members
  set status = 'active'
  where community_id = p_community_id
    and user_id = p_user_id
    and role = 'member'
    and status = 'pending';

  if not found then
    raise exception 'Pending community member not found';
  end if;
end;
$$;
revoke all on function public.approve_community_member(uuid,uuid) from public;
grant execute on function public.approve_community_member(uuid,uuid) to authenticated;

commit;
