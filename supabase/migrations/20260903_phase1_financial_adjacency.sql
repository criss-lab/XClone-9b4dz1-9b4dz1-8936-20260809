-- Financial adjunct tables. This migration follows the canonical wallet migration.

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  wallet_transaction_id uuid references public.wallet_transactions(id) on delete restrict, amount numeric(20,8) not null check (amount > 0),
  fee_amount numeric(20,8) not null default 0, currency text not null default 'USD', payout_currency text not null default 'KES', fx_rate numeric(20,8),
  status text not null default 'pending', idempotency_key text not null, provider text, provider_transaction_id text, provider_reference text,
  failure_code text, failure_reason text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
  unique(user_id,idempotency_key)
);
create unique index if not exists uq_withdrawal_provider_tx on public.withdrawal_requests(provider,provider_transaction_id) where provider is not null and provider_transaction_id is not null;
create index if not exists idx_withdrawal_status_updated on public.withdrawal_requests(status,updated_at);

create table if not exists public.payment_idempotency (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, operation text not null, idempotency_key text not null,
  request_hash text, status text not null default 'processing', response jsonb, created_at timestamptz not null default now(), completed_at timestamptz,
  unique(operation,idempotency_key)
);

create table if not exists public.creator_earning_postings (
  id uuid primary key default gen_random_uuid(), source text not null, source_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(20,8) not null check (amount > 0), currency text not null default 'USD', wallet_transaction_id uuid references public.wallet_transactions(id), creator_earning_id uuid, created_at timestamptz not null default now(),
  unique(source,source_id,user_id)
);

create table if not exists public.ad_revenue_distributions (
  id uuid primary key default gen_random_uuid(), period_start date not null, period_end date not null, user_id uuid not null references auth.users(id) on delete cascade,
  views bigint not null default 0, total_views bigint not null default 0, gross_revenue numeric(20,8) not null default 0, creator_share numeric(20,8) not null default 0,
  currency text not null default 'USD', wallet_transaction_id uuid references public.wallet_transactions(id), created_at timestamptz not null default now(), unique(period_start,period_end,user_id)
);

create table if not exists public.refund_transactions (
  id uuid primary key default gen_random_uuid(), original_transaction_id uuid not null references public.wallet_transactions(id), user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(20,8) not null check (amount > 0), currency text not null, reason text not null, idempotency_key text not null unique, status text not null default 'completed',
  refund_transaction_id uuid references public.wallet_transactions(id), created_at timestamptz not null default now()
);

create table if not exists public.payment_reconciliation_events (
  id uuid primary key default gen_random_uuid(), provider text not null, provider_transaction_id text not null, event_type text not null, expected_status text,
  observed_status text, payload_hash text, payload jsonb not null default '{}'::jsonb, resolved boolean not null default false, created_at timestamptz not null default now(),
  unique(provider,provider_transaction_id,event_type,payload_hash)
);

alter table public.withdrawal_requests enable row level security;
alter table public.payment_idempotency enable row level security;
alter table public.creator_earning_postings enable row level security;
alter table public.ad_revenue_distributions enable row level security;
alter table public.refund_transactions enable row level security;
alter table public.payment_reconciliation_events enable row level security;

drop policy if exists withdrawal_own_read on public.withdrawal_requests;
create policy withdrawal_own_read on public.withdrawal_requests for select to authenticated using (user_id=auth.uid());
drop policy if exists ad_distribution_own_read on public.ad_revenue_distributions;
create policy ad_distribution_own_read on public.ad_revenue_distributions for select to authenticated using (user_id=auth.uid());
