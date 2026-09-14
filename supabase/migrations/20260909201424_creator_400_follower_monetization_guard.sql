begin;

-- Creator monetization eligibility is intentionally separate from paid advertising.
-- Anyone may spend money to boost content or buy an ad; creator revenue requires
-- a minimum audience of 400 followers.

create or replace function public.creator_follower_count(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint
  from public.follows f
  where f.following_id = p_user_id;
$$;

revoke all on function public.creator_follower_count(uuid) from public;
grant execute on function public.creator_follower_count(uuid) to authenticated;

create or replace function public.is_creator_monetization_eligible(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.creator_follower_count(p_user_id), 0) >= 400;
$$;

revoke all on function public.is_creator_monetization_eligible(uuid) from public;
grant execute on function public.is_creator_monetization_eligible(uuid) to authenticated, service_role;

alter table public.creator_programs
  add column if not exists follower_requirement integer not null default 400,
  add column if not exists eligible boolean not null default false,
  add column if not exists eligibility_checked_at timestamptz;

create or replace function public.refresh_creator_program_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  followers bigint;
begin
  followers := public.creator_follower_count(new.user_id);
  new.follower_requirement := 400;
  new.eligible := followers >= 400;
  new.eligibility_checked_at := now();

  if new.enabled and followers < 400 then
    raise exception 'CREATOR_MONETIZATION_REQUIRES_400_FOLLOWERS: % followers found', followers
      using errcode = '42501';
  end if;

  if not new.eligible then
    new.enabled := false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_creator_program_400_followers on public.creator_programs;
create trigger trg_creator_program_400_followers
before insert or update of enabled, user_id on public.creator_programs
for each row execute function public.refresh_creator_program_eligibility();

create or replace function public.assert_creator_revenue_eligibility(p_creator_id uuid, p_entry_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  followers bigint;
begin
  if p_entry_type in ('ad_revenue','sponsorship','paid_content','digital_product','live_event','live_gift','community','affiliate','creator_earning') then
    followers := public.creator_follower_count(p_creator_id);
    if followers < 400 then
      raise exception 'CREATOR_MONETIZATION_REQUIRES_400_FOLLOWERS: % followers found', followers
        using errcode = '42501';
    end if;
  end if;
end;
$$;

revoke all on function public.assert_creator_revenue_eligibility(uuid,text) from public;
grant execute on function public.assert_creator_revenue_eligibility(uuid,text) to service_role;

create or replace function public.record_creator_earning(
  p_creator_id uuid,
  p_entry_type text,
  p_gross_cents bigint,
  p_idempotency_key text,
  p_provider text default null,
  p_provider_event_id text default null,
  p_source_type text default null,
  p_source_id text default null,
  p_description text default '',
  p_metadata jsonb default '{}'::jsonb,
  p_creator_share_bps integer default null
) returns public.monetization_ledger
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.monetization_settings;
  e public.monetization_ledger;
  share_bps integer;
  creator_cents bigint;
  fee_cents bigint;
begin
  if (select current_user) <> 'service_role' then raise exception 'server_only'; end if;
  if p_creator_id is null or p_gross_cents <= 0 then raise exception 'invalid earning'; end if;
  if p_entry_type not in ('tip','subscription','super_follow','paid_content','ad_revenue','sponsorship','digital_product','live_event','live_gift','community','affiliate','creator_earning') then raise exception 'invalid earning type'; end if;
  perform public.assert_creator_revenue_eligibility(p_creator_id, p_entry_type);
  select * into s from public.monetization_settings where id=true;
  share_bps:=coalesce(p_creator_share_bps,s.creator_share_bps);
  if share_bps < 0 or share_bps > 10000 then raise exception 'invalid creator share'; end if;
  creator_cents:=floor((p_gross_cents*share_bps)::numeric/10000);
  fee_cents:=p_gross_cents-creator_cents;
  select * into e from public.monetization_ledger where account_user_id=p_creator_id and idempotency_key=p_idempotency_key;
  if found then return e; end if;
  insert into public.monetization_accounts(user_id,currency) values(p_creator_id,'USD') on conflict(user_id) do nothing;
  insert into public.monetization_ledger(account_user_id,entry_type,direction,amount_cents,currency,state,gross_cents,platform_fee_cents,creator_share_bps,provider,provider_event_id,idempotency_key,source_type,source_id,description,metadata,available_at)
  values(p_creator_id,p_entry_type,'credit',creator_cents,'USD','pending',p_gross_cents,fee_cents,share_bps,p_provider,p_provider_event_id,p_idempotency_key,p_source_type,p_source_id,p_description,coalesce(p_metadata,'{}'::jsonb),now()+make_interval(days=>s.payout_hold_days)) returning * into e;
  update public.monetization_accounts set pending_cents=pending_cents+creator_cents,lifetime_earned_cents=lifetime_earned_cents+creator_cents,updated_at=now() where user_id=p_creator_id;
  return e;
end;
$$;

revoke all on function public.record_creator_earning(uuid,text,bigint,text,text,text,text,text,text,jsonb,integer) from public;
grant execute on function public.record_creator_earning(uuid,text,bigint,text,text,text,text,text,text,jsonb,integer) to service_role;

update public.creator_programs cp
set follower_requirement = 400,
    eligible = (select count(*) from public.follows f where f.following_id = cp.user_id) >= 400,
    eligibility_checked_at = now(),
    enabled = cp.enabled and (select count(*) from public.follows f where f.following_id = cp.user_id) >= 400;

commit;
