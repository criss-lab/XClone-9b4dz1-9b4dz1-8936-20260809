create table if not exists public.daily_rewards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  streak_day integer not null default 0 check (streak_day between 0 and 7),
  credits_earned bigint not null default 0 check (credits_earned >= 0),
  last_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits bigint not null default 0 check (credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.daily_rewards enable row level security;
alter table public.user_wallets enable row level security;
alter table public.credit_transactions enable row level security;

drop policy if exists daily_rewards_select_own on public.daily_rewards;
create policy daily_rewards_select_own on public.daily_rewards for select using (auth.uid() = user_id);
drop policy if exists user_wallets_select_own on public.user_wallets;
create policy user_wallets_select_own on public.user_wallets for select using (auth.uid() = user_id);
drop policy if exists credit_transactions_select_own on public.credit_transactions;
create policy credit_transactions_select_own on public.credit_transactions for select using (auth.uid() = user_id);

create or replace function public.claim_daily_reward()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.daily_rewards%rowtype; w public.user_wallets%rowtype; now_at timestamptz := now(); today date := (now_at at time zone 'UTC')::date; next_streak integer; earned bigint; new_balance bigint;
begin
  if uid is null then raise exception using errcode='28000', message='Authentication required'; end if;
  insert into public.daily_rewards(user_id) values(uid) on conflict(user_id) do nothing;
  select * into r from public.daily_rewards where user_id=uid for update;
  if r.last_claimed_at is not null and (r.last_claimed_at at time zone 'UTC')::date=today then raise exception using message='Reward already claimed today'; end if;
  if r.last_claimed_at is not null and (r.last_claimed_at at time zone 'UTC')::date=(today-1) then next_streak:=least(r.streak_day+1,7); else next_streak:=1; end if;
  earned:=case next_streak when 1 then 10 when 2 then 15 when 3 then 20 when 4 then 25 when 5 then 30 when 6 then 40 when 7 then 50 else 10 end;
  insert into public.user_wallets(user_id) values(uid) on conflict(user_id) do nothing;
  select * into w from public.user_wallets where user_id=uid for update;
  new_balance:=w.credits+earned;
  update public.daily_rewards set streak_day=next_streak,credits_earned=earned,last_claimed_at=now_at,updated_at=now_at where user_id=uid;
  insert into public.credit_transactions(user_id,amount,reason) values(uid,earned,format('Daily streak reward — Day %s',next_streak));
  update public.user_wallets set credits=new_balance,updated_at=now_at where user_id=uid;
  return jsonb_build_object('ok',true,'streak_day',next_streak,'credits_earned',earned,'wallet_credits',new_balance,'claimed_at',now_at);
end; $$;
revoke all on function public.claim_daily_reward() from public;
grant execute on function public.claim_daily_reward() to authenticated;
