begin;
create table if not exists public.monetization_settings (
  id boolean primary key default true check (id),
  creator_share_percent numeric(5,2) not null default 70 check (creator_share_percent between 0 and 100),
  platform_share_percent numeric(5,2) not null default 30 check (platform_share_percent between 0 and 100),
  tips_creator_share_percent numeric(5,2) not null default 85,
  subscriptions_creator_share_percent numeric(5,2) not null default 70,
  paid_content_creator_share_percent numeric(5,2) not null default 70,
  creator_fund_creator_share_percent numeric(5,2) not null default 40,
  ads_creator_share_percent numeric(5,2) not null default 40,
  boost_creator_share_percent numeric(5,2) not null default 0,
  marketplace_creator_share_percent numeric(5,2) not null default 90,
  min_creator_payout numeric(20,6) not null default 5,
  payout_hold_days integer not null default 7,
  monetization_enabled boolean not null default true,
  tips_enabled boolean not null default true,
  subscriptions_enabled boolean not null default true,
  paid_content_enabled boolean not null default true,
  creator_fund_enabled boolean not null default true,
  ads_revenue_share_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.monetization_settings(id) values(true) on conflict (id) do nothing;
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','finance','support','auditor')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.platform_treasury (
  currency text primary key,
  balance numeric(20,6) not null default 0,
  lifetime_revenue numeric(20,6) not null default 0,
  lifetime_creator_share numeric(20,6) not null default 0,
  lifetime_refunds numeric(20,6) not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.platform_treasury(currency) values('USD'),('KES') on conflict do nothing;
create table if not exists public.monetization_events (
  id uuid primary key default gen_random_uuid(), payer_id uuid references auth.users(id) on delete set null,
  creator_id uuid references auth.users(id) on delete set null, event_type text not null,
  gross_amount numeric(20,6) not null check(gross_amount>0), creator_amount numeric(20,6) not null default 0,
  platform_amount numeric(20,6) not null default 0, currency text not null default 'USD', provider text not null default 'internal',
  provider_reference text, status text not null default 'completed', metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), completed_at timestamptz, unique(provider,provider_reference)
);
create table if not exists public.creator_earnings (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  source text not null, amount numeric(20,6) not null, currency text not null default 'USD', post_id uuid,
  monetization_event_id uuid references public.monetization_events(id) on delete set null,
  status text not null default 'completed', created_at timestamptz not null default now(), unique(monetization_event_id)
);
create table if not exists public.revenue_shares (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_revenue numeric(20,6) not null default 0, platform_share numeric(20,6) not null default 0,
  user_share numeric(20,6) not null default 0, paid_to_platform numeric(20,6) not null default 0,
  paid_to_user numeric(20,6) not null default 0, updated_at timestamptz not null default now()
);
create table if not exists public.user_monetization (
  user_id uuid primary key references auth.users(id) on delete cascade, is_monetized boolean not null default false,
  revenue_share_percentage numeric(5,2) not null default 70, total_earnings numeric(20,6) not null default 0,
  total_views bigint not null default 0, updated_at timestamptz not null default now()
);
create table if not exists public.video_revenue_rates (
  user_id uuid primary key references auth.users(id) on delete cascade, tier text not null default 'standard',
  cpm_usd numeric(20,6) not null default 1.50, period_views bigint not null default 0,
  period_revenue numeric(20,6) not null default 0, last_updated timestamptz not null default now()
);
create table if not exists public.creator_subscriptions (
  id uuid primary key default gen_random_uuid(), subscriber_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade, tier text not null, amount numeric(20,6) not null,
  currency text not null default 'USD', status text not null default 'active', started_at timestamptz not null default now(),
  expires_at timestamptz, monetization_event_id uuid references public.monetization_events(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.ad_placements (
  id uuid primary key default gen_random_uuid(), advertiser_id uuid references auth.users(id) on delete set null,
  creator_id uuid references auth.users(id) on delete set null, revenue numeric(20,6) not null default 0,
  currency text not null default 'USD', impressions bigint not null default 0, clicks bigint not null default 0,
  status text not null default 'completed', created_at timestamptz not null default now()
);
create table if not exists public.creator_payouts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null, amount numeric(20,6) not null,
  currency text not null default 'USD', provider text not null, destination text,
  status text not null default 'pending', requested_at timestamptz not null default now(), approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null, completed_at timestamptz, provider_reference text,
  metadata jsonb not null default '{}'::jsonb
);
alter table public.posts add column if not exists fund_earnings_paid boolean not null default false;
alter table public.wallets add column if not exists status text not null default 'active';
alter table public.wallets add column if not exists spending_enabled boolean not null default true;
alter table public.wallets add column if not exists withdrawals_enabled boolean not null default true;
alter table public.wallets add column if not exists frozen_reason text;
alter table public.wallets add column if not exists frozen_at timestamptz;
alter table public.monetization_settings enable row level security;
alter table public.platform_admins enable row level security;
alter table public.platform_treasury enable row level security;
alter table public.monetization_events enable row level security;
alter table public.creator_earnings enable row level security;
alter table public.revenue_shares enable row level security;
alter table public.user_monetization enable row level security;
alter table public.video_revenue_rates enable row level security;
alter table public.creator_subscriptions enable row level security;
alter table public.ad_placements enable row level security;
alter table public.creator_payouts enable row level security;
create or replace function public.is_platform_admin(p_user_id uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.platform_admins where user_id=p_user_id); $$;
revoke all on function public.is_platform_admin(uuid) from public;
grant execute on function public.is_platform_admin(uuid) to authenticated;
create policy monetization_events_read on public.monetization_events for select to authenticated using(payer_id=auth.uid() or creator_id=auth.uid() or public.is_platform_admin());
create policy creator_earnings_read on public.creator_earnings for select to authenticated using(user_id=auth.uid() or public.is_platform_admin());
create policy revenue_shares_read on public.revenue_shares for select to authenticated using(user_id=auth.uid() or public.is_platform_admin());
create policy user_monetization_own on public.user_monetization for all to authenticated using(user_id=auth.uid() or public.is_platform_admin()) with check(user_id=auth.uid() or public.is_platform_admin());
create policy video_rates_read on public.video_revenue_rates for select to authenticated using(user_id=auth.uid() or public.is_platform_admin());
create policy subscriptions_read on public.creator_subscriptions for select to authenticated using(subscriber_id=auth.uid() or creator_id=auth.uid() or public.is_platform_admin());
create policy creator_payouts_read on public.creator_payouts for select to authenticated using(user_id=auth.uid() or public.is_platform_admin());
create policy monetization_settings_read on public.monetization_settings for select to authenticated using(true);
create policy treasury_admin_read on public.platform_treasury for select to authenticated using(public.is_platform_admin());
-- Service-role settlement is the only path that can mint creator earnings from an external payment.
create or replace function public.settle_monetization_event(p_payer_id uuid,p_creator_id uuid,p_event_type text,p_gross_amount numeric,p_currency text default 'USD',p_provider text default 'internal',p_provider_reference text default null,p_metadata jsonb default '{}'::jsonb) returns public.monetization_events language plpgsql security definer set search_path=public as $$
declare e public.monetization_events; w public.wallets; s public.monetization_settings; pct numeric; ca numeric; pa numeric;
begin
 if auth.uid() is not null and not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
 if p_gross_amount<=0 then raise exception 'INVALID_AMOUNT'; end if;
 select * into s from public.monetization_settings where id=true for share;
 pct:=case p_event_type when 'tip' then s.tips_creator_share_percent when 'subscription' then s.subscriptions_creator_share_percent when 'paid_content' then s.paid_content_creator_share_percent when 'creator_fund' then s.creator_fund_creator_share_percent when 'ad_revenue' then s.ads_creator_share_percent when 'boost' then s.boost_creator_share_percent when 'marketplace' then s.marketplace_creator_share_percent else s.creator_share_percent end;
 ca:=round(p_gross_amount*pct/100,6); pa:=round(p_gross_amount-ca,6);
 if p_provider_reference is not null then select * into e from public.monetization_events where provider=p_provider and provider_reference=p_provider_reference for update; if found then return e; end if; end if;
 if p_provider='internal' then
   select * into w from public.wallets where user_id=p_payer_id for update;
   if not found or w.status<>'active' or not w.spending_enabled or w.currency<>p_currency or w.balance<p_gross_amount then raise exception 'PAYER_WALLET_UNAVAILABLE'; end if;
   update public.wallets set balance=balance-p_gross_amount,updated_at=now() where id=w.id;
   insert into public.wallet_transactions(wallet_id,user_id,type,status,amount,currency,balance_before,balance_after,provider,provider_reference,description,metadata,completed_at,payment_method,reference) values(w.id,p_payer_id,'spend','completed',p_gross_amount,p_currency,w.balance,w.balance-p_gross_amount,'internal',p_provider_reference,'Monetization purchase',coalesce(p_metadata,'{}'::jsonb),now(),'wallet',p_provider_reference);
 end if;
 insert into public.monetization_events(payer_id,creator_id,event_type,gross_amount,creator_amount,platform_amount,currency,provider,provider_reference,status,metadata,completed_at) values(p_payer_id,p_creator_id,p_event_type,p_gross_amount,ca,pa,p_currency,p_provider,p_provider_reference,'completed',coalesce(p_metadata,'{}'::jsonb),now()) returning * into e;
 if p_creator_id is not null and ca>0 then
   perform public.credit_wallet_deposit(p_creator_id,ca,p_currency,'monetization',coalesce(p_provider_reference,e.id::text),'completed','creator_earning',p_event_type,jsonb_build_object('event_id',e.id,'creator_share_percent',pct,'platform_amount',pa)||coalesce(p_metadata,'{}'::jsonb));
   insert into public.creator_earnings(user_id,source,amount,currency,monetization_event_id,status) values(p_creator_id,p_event_type,ca,p_currency,e.id,'completed');
   insert into public.user_monetization(user_id,is_monetized,total_earnings) values(p_creator_id,true,ca) on conflict(user_id) do update set is_monetized=true,total_earnings=public.user_monetization.total_earnings+excluded.total_earnings,updated_at=now();
   insert into public.revenue_shares(user_id,total_revenue,platform_share,user_share,paid_to_platform,paid_to_user) values(p_creator_id,p_gross_amount,pa,ca,pa,ca) on conflict(user_id) do update set total_revenue=public.revenue_shares.total_revenue+excluded.total_revenue,platform_share=public.revenue_shares.platform_share+excluded.platform_share,user_share=public.revenue_shares.user_share+excluded.user_share,paid_to_platform=public.revenue_shares.paid_to_platform+excluded.paid_to_platform,paid_to_user=public.revenue_shares.paid_to_user+excluded.paid_to_user,updated_at=now();
 end if;
 insert into public.platform_treasury(currency,balance,lifetime_revenue,lifetime_creator_share) values(p_currency,pa,p_gross_amount,ca) on conflict(currency) do update set balance=public.platform_treasury.balance+excluded.balance,lifetime_revenue=public.platform_treasury.lifetime_revenue+excluded.lifetime_revenue,lifetime_creator_share=public.platform_treasury.lifetime_creator_share+excluded.lifetime_creator_share,updated_at=now();
 return e;
end; $$;
revoke all on function public.settle_monetization_event(uuid,uuid,text,numeric,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.settle_monetization_event(uuid,uuid,text,numeric,text,text,text,jsonb) to service_role;
create or replace function public.platform_bootstrap_owner(p_user_id uuid) returns public.platform_admins language plpgsql security definer set search_path=public as $$ declare a public.platform_admins; n integer; begin if auth.uid() is not null then raise exception 'SERVICE_ROLE_ONLY'; end if; select count(*) into n from public.platform_admins; if n>0 then raise exception 'OWNER_ALREADY_CONFIGURED'; end if; insert into public.platform_admins(user_id,role) values(p_user_id,'owner') returning * into a; return a; end; $$;
revoke all on function public.platform_bootstrap_owner(uuid) from public,anon,authenticated;
grant execute on function public.platform_bootstrap_owner(uuid) to service_role;
commit;
