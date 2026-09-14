begin;

-- The existing backend contract and owner-membership trigger intentionally use
-- role='owner', but the legacy check constraint rejected that role. Restore the
-- intended owner role rather than downgrading ownership to admin.
alter table public.community_members
  drop constraint if exists community_members_role_check;

alter table public.community_members
  add constraint community_members_role_check
  check (role = any (array['member'::text, 'moderator'::text, 'admin'::text, 'owner'::text]));

-- Owner membership is also created by the AFTER INSERT trigger. Keep the RPC
-- idempotent so either direct inserts or RPC creation are safe.
create or replace function public.create_community(
  p_name text,
  p_display_name text,
  p_description text default '',
  p_is_private boolean default false,
  p_rules jsonb default '[]'::jsonb,
  p_icon_url text default null,
  p_banner_url text default null
)
returns public.communities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '', 'g'));
  v_slug text := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_community public.communities;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if v_name = '' or char_length(v_name) > 80 then raise exception 'Invalid community name'; end if;
  if trim(coalesce(p_display_name, '')) = '' or char_length(trim(p_display_name)) > 120 then raise exception 'Invalid display name'; end if;
  if exists (select 1 from public.communities c where c.name = v_name or c.slug = v_slug) then
    raise exception 'Community name is already taken';
  end if;
  insert into public.communities (
    owner_id, created_by, name, slug, display_name, description,
    is_private, icon_url, banner_url, rules
  ) values (
    v_user, v_user, v_name, v_slug, trim(p_display_name), coalesce(p_description, ''),
    coalesce(p_is_private, false), p_icon_url, p_banner_url, coalesce(p_rules, '[]'::jsonb)
  ) returning * into v_community;

  insert into public.community_members (community_id, user_id, role, status)
  values (v_community.id, v_user, 'owner', 'active')
  on conflict (community_id, user_id) do update
    set role = 'owner', status = 'active';

  return v_community;
end;
$$;

revoke all on function public.create_community(text,text,text,boolean,jsonb,text,text) from public;
grant execute on function public.create_community(text,text,text,boolean,jsonb,text,text) to authenticated;

commit;
