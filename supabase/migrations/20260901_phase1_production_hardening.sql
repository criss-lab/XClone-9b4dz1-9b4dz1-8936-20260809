-- Phase 1 production hardening
-- Canonical wallet: user_wallets / wallet_transactions.
-- Legacy wallets / transactions remain untouched for compatibility; data is
-- copied into the canonical ledger and new money movement uses the canonical
-- tables and atomic SECURITY DEFINER functions.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Canonical wallet
-- ---------------------------------------------------------------------------
create table if not exists public.user_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  balance numeric(20,8) not null default 0,
  reserved_balance numeric(20,8) not null default 0,
  currency text not null default 'USD',
  mpesa_phone text,
  budget_settings jsonb not null default '{}'::jsonb,
  daily_spend_limit numeric(20,8),
  spend_limit_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_wallets_balance_nonnegative check (balance >= 0),
  constraint user_wallets_reserved_nonnegative check (reserved_balance >= 0),
  constraint user_wallets_reserved_not_over_balance check (reserved_balance <= balance),
  constraint user_wallets_currency_check check (currency in ('USD','KES'))
);

alter table public.user_wallets add column if not exists reserved_balance numeric(20,8) not null default 0;
alter table public.user_wallets add column if not exists currency text not null default 'USD';
alter table public.user_wallets add column if not exists mpesa_phone text;
alter table public.user_wallets add column if not exists budget_settings jsonb not null default '{}'::jsonb;
alter table public.user_wallets add column if not exists daily_spend_limit numeric(20,8);
alter table public.user_wallets add column if not exists spend_limit_enabled boolean not null default false;
alter table public.user_wallets add column if not exists created_at timestamptz not null default now();
alter table public.user_wallets add column if not exists updated_at timestamptz not null default now();

-- Normalize the historical KES wallet table into the canonical USD ledger only
-- when the canonical table is empty. This is deliberately conservative.
insert into public.user_wallets (user_id, balance, currency)
select w.user_id::uuid, w.balance, coalesce(nullif(w.currency,''),'USD')
from public.wallets w
where w.user_id ~ '^[0-9a-fA-F-]{36}$'
  and not exists (select 1 from public.user_wallets uw where uw.user_id = w.user_id::uuid)
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Canonical transaction ledger
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid references public.user_wallets(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  amount numeric(20,8) not null,
  currency text not null default 'USD',
  amount_kes numeric(20,2),
  fx_rate numeric(20,8),
  fee_amount numeric(20,8) not null default 0,
  status text not null default 'pending',
  payment_method text,
  provider text,
  provider_transaction_id text,
  idempotency_key text,
  reference text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wallet_transactions add column if not exists wallet_id uuid references public.user_wallets(id) on delete set null;
alter table public.wallet_transactions add column if not exists currency text not null default 'USD';
alter table public.wallet_transactions add column if not exists amount_kes numeric(20,2);
alter table public.wallet_transactions add column if not exists fx_rate numeric(20,8);
alter table public.wallet_transactions add column if not exists fee_amount numeric(20,8) not null default 0;
alter table public.wallet_transactions add column if not exists provider text;
alter table public.wallet_transactions add column if not exists provider_transaction_id text;
alter table public.wallet_transactions add column if not exists idempotency_key text;
alter table public.wallet_transactions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.wallet_transactions add column if not exists updated_at timestamptz not null default now();

create unique index if not exists uq_wallet_tx_provider_id
  on public.wallet_transactions(provider, provider_transaction_id)
  where provider is not null and provider_transaction_id is not null;
create unique index if not exists uq_wallet_tx_idempotency
  on public.wallet_transactions(user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_wallet_tx_user_created
  on public.wallet_transactions(user_id, created_at desc);
create index if not exists idx_wallet_tx_status
  on public.wallet_transactions(status);

-- ---------------------------------------------------------------------------
-- Payment provider ledger
-- ---------------------------------------------------------------------------
create table if not exists public.mpesa_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  checkout_request_id text unique,
  merchant_request_id text,
  phone_number text,
  amount numeric(20,2) not null,
  currency text not null default 'KES',
  type text not null,
  purpose text,
  status text not null default 'pending',
  result_code text,
  result_desc text,
  mpesa_receipt_number text unique,
  idempotency_key text,
  wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mpesa_transactions add column if not exists currency text not null default 'KES';
alter table public.mpesa_transactions add column if not exists result_code text;
alter table public.mpesa_transactions add column if not exists result_desc text;
alter table public.mpesa_transactions add column if not exists mpesa_receipt_number text;
alter table public.mpesa_transactions add column if not exists idempotency_key text;
alter table public.mpesa_transactions add column if not exists wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null;
alter table public.mpesa_transactions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.mpesa_transactions add column if not exists updated_at timestamptz not null default now();

create unique index if not exists uq_mpesa_idempotency
  on public.mpesa_transactions(idempotency_key)
  where idempotency_key is not null;
create unique index if not exists uq_mpesa_receipt
  on public.mpesa_transactions(mpesa_receipt_number)
  where mpesa_receipt_number is not null;

-- ---------------------------------------------------------------------------
-- FX + platform configuration
-- ---------------------------------------------------------------------------
create table if not exists public.platform_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null,
  quote_currency text not null,
  rate numeric(20,8) not null check (rate > 0),
  source text not null default 'platform',
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(base_currency, quote_currency, effective_at)
);

create index if not exists idx_fx_pair_effective
  on public.platform_exchange_rates(base_currency, quote_currency, effective_at desc);

insert into public.platform_exchange_rates(base_currency, quote_currency, rate, source)
select 'USD','KES',130,'legacy-default'
where not exists (
  select 1 from public.platform_exchange_rates where base_currency='USD' and quote_currency='KES'
);

create table if not exists public.platform_fee_settings (
  id uuid primary key default gen_random_uuid(),
  fee_code text unique not null,
  fee_rate numeric(12,8) not null default 0 check (fee_rate >= 0 and fee_rate <= 1),
  fixed_amount numeric(20,8) not null default 0 check (fixed_amount >= 0),
  currency text not null default 'USD',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.platform_fee_settings(fee_code, fee_rate, fixed_amount)
values ('mpesa_withdrawal', 0, 0)
on conflict (fee_code) do nothing;

-- ---------------------------------------------------------------------------
-- Audit/security events
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id text,
  status text not null default 'success',
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_actor_created on public.audit_logs(actor_user_id, created_at desc);
create index if not exists idx_audit_resource on public.audit_logs(resource_type, resource_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Atomic wallet primitives
-- ---------------------------------------------------------------------------
create or replace function public.add_to_wallet(p_user_id uuid, p_amount numeric)
returns public.user_wallets
language plpgsql
security definer
set search_path = public
as $$
declare r public.user_wallets;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  insert into public.user_wallets(user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.user_wallets
     set balance = balance + p_amount, updated_at = now()
   where user_id = p_user_id
   returning * into r;
  return r;
end;
$$;

create or replace function public.reserve_wallet_funds(
  p_user_id uuid,
  p_amount numeric,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.user_wallets;
  v_tx public.wallet_transactions;
  v_existing uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  if p_idempotency_key is not null then
    select id into v_existing from public.wallet_transactions
    where user_id=p_user_id and idempotency_key=p_idempotency_key limit 1;
    if v_existing is not null then return v_existing; end if;
  end if;

  select * into v_wallet from public.user_wallets where user_id=p_user_id for update;
  if not found then raise exception 'Wallet not found'; end if;
  if (v_wallet.balance - v_wallet.reserved_balance) < p_amount then
    raise exception 'Insufficient available balance';
  end if;

  update public.user_wallets
     set reserved_balance = reserved_balance + p_amount, updated_at=now()
   where user_id=p_user_id;

  insert into public.wallet_transactions(
    wallet_id,user_id,type,amount,currency,status,idempotency_key,description
  ) values (
    v_wallet.id,p_user_id,'withdrawal',p_amount,v_wallet.currency,'reserved',p_idempotency_key,'Withdrawal funds reserved'
  ) returning * into v_tx;

  return v_tx.id;
end;
$$;

create or replace function public.finalize_wallet_withdrawal(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_tx public.wallet_transactions;
begin
  select * into v_tx from public.wallet_transactions where id=p_transaction_id for update;
  if not found then raise exception 'Wallet transaction not found'; end if;
  if v_tx.status='completed' then return; end if;
  if v_tx.status <> 'reserved' then raise exception 'Withdrawal is not reserved'; end if;

  update public.user_wallets
     set balance = balance - v_tx.amount,
         reserved_balance = reserved_balance - v_tx.amount,
         updated_at=now()
   where user_id=v_tx.user_id;

  update public.wallet_transactions
     set status='completed', updated_at=now()
   where id=v_tx.id;
end;
$$;

create or replace function public.release_wallet_reservation(p_transaction_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_tx public.wallet_transactions;
begin
  select * into v_tx from public.wallet_transactions where id=p_transaction_id for update;
  if not found then raise exception 'Wallet transaction not found'; end if;
  if v_tx.status='failed' or v_tx.status='released' then return; end if;
  if v_tx.status <> 'reserved' then raise exception 'Withdrawal is not reserved'; end if;

  update public.user_wallets
     set reserved_balance = reserved_balance - v_tx.amount,
         updated_at=now()
   where user_id=v_tx.user_id;

  update public.wallet_transactions
     set status='released', description=coalesce(p_reason,description), updated_at=now()
   where id=v_tx.id;
end;
$$;

revoke all on function public.add_to_wallet(uuid,numeric) from public, anon, authenticated;
revoke all on function public.reserve_wallet_funds(uuid,numeric,text) from public, anon, authenticated;
revoke all on function public.finalize_wallet_withdrawal(uuid) from public, anon, authenticated;
revoke all on function public.release_wallet_reservation(uuid,text) from public, anon, authenticated;

grant execute on function public.add_to_wallet(uuid,numeric) to service_role;
grant execute on function public.reserve_wallet_funds(uuid,numeric,text) to service_role;
grant execute on function public.finalize_wallet_withdrawal(uuid) to service_role;
grant execute on function public.release_wallet_reservation(uuid,text) to service_role;

-- ---------------------------------------------------------------------------
-- RLS: users may read their own wallet/transactions; service_role can operate.
-- ---------------------------------------------------------------------------
alter table public.user_wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.mpesa_transactions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.platform_exchange_rates enable row level security;
alter table public.platform_fee_settings enable row level security;

drop policy if exists user_wallets_select_own on public.user_wallets;
create policy user_wallets_select_own on public.user_wallets for select to authenticated using (user_id = auth.uid());

drop policy if exists wallet_transactions_select_own on public.wallet_transactions;
create policy wallet_transactions_select_own on public.wallet_transactions for select to authenticated using (user_id = auth.uid());

drop policy if exists mpesa_transactions_select_own on public.mpesa_transactions;
create policy mpesa_transactions_select_own on public.mpesa_transactions for select to authenticated using (user_id = auth.uid());

drop policy if exists audit_logs_select_own on public.audit_logs;
create policy audit_logs_select_own on public.audit_logs for select to authenticated using (actor_user_id = auth.uid());

-- FX is public configuration/read-only; writes are service-role only.
drop policy if exists fx_read_authenticated on public.platform_exchange_rates;
create policy fx_read_authenticated on public.platform_exchange_rates for select to authenticated using (true);

-- Fee configuration is not exposed to normal users.

-- No INSERT/UPDATE/DELETE policies are granted to normal users for financial tables.

-- ---------------------------------------------------------------------------
-- Timestamp trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path=public as $$
begin new.updated_at=now(); return new; end; $$;

drop trigger if exists trg_user_wallets_updated_at on public.user_wallets;
create trigger trg_user_wallets_updated_at before update on public.user_wallets for each row execute function public.set_updated_at();
drop trigger if exists trg_wallet_transactions_updated_at on public.wallet_transactions;
create trigger trg_wallet_transactions_updated_at before update on public.wallet_transactions for each row execute function public.set_updated_at();
drop trigger if exists trg_mpesa_transactions_updated_at on public.mpesa_transactions;
create trigger trg_mpesa_transactions_updated_at before update on public.mpesa_transactions for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Backward-compatible legacy tables: freeze writes from normal clients.
-- Existing application code can continue reading them while the canonical
-- ledger is user_wallets/wallet_transactions.
-- ---------------------------------------------------------------------------
alter table if exists public.wallets enable row level security;
alter table if exists public.transactions enable row level security;

comment on table public.user_wallets is 'Canonical wallet ledger. Legacy wallets table is compatibility-only.';
comment on table public.wallet_transactions is 'Canonical financial transaction ledger.';
comment on table public.wallets is 'LEGACY compatibility table. Do not use for new money movement.';
comment on table public.transactions is 'LEGACY compatibility table. Do not use for new money movement.';
