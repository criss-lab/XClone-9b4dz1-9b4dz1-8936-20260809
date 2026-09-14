begin;
-- Production PayPal wallet ledger for XClone.
-- Existing wallet schema is preserved; the production wallets.user_id column is uuid.

create table if not exists public.paypal_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete set null,
  paypal_order_id text not null unique,
  amount numeric not null check (amount > 0),
  currency text not null default 'KES',
  status text not null default 'created' check (status in ('created','approved','captured','failed','cancelled')),
  approval_url text,
  capture_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_paypal_orders_user on public.paypal_orders(user_id, created_at desc);
create index if not exists idx_paypal_orders_status on public.paypal_orders(status);
create unique index if not exists idx_paypal_orders_capture on public.paypal_orders(capture_id) where capture_id is not null;
create table if not exists public.paypal_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  paypal_order_id text,
  paypal_capture_id text,
  transmission_id text,
  payload jsonb not null,
  verified boolean not null default false,
  processed boolean not null default false,
  processing_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists idx_paypal_webhook_order on public.paypal_webhook_events(paypal_order_id);
create index if not exists idx_paypal_webhook_received on public.paypal_webhook_events(received_at desc);
alter table public.wallets enable row level security;
alter table public.transactions enable row level security;
alter table public.paypal_orders enable row level security;
alter table public.paypal_webhook_events enable row level security;
-- Wallet bootstrap is safe to call repeatedly and only permits a user to bootstrap itself.
create or replace function public.ensure_wallet(p_user_id uuid)
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.wallets;
begin
  if p_user_id is null then raise exception 'user_id_required'; end if;
  if auth.role() = 'authenticated' and auth.uid() <> p_user_id then
    raise exception 'not_authorized';
  end if;

  insert into public.wallets(user_id, balance, currency)
  values (p_user_id, 0, 'KES')
  on conflict (user_id) do nothing;

  select * into result from public.wallets where user_id = p_user_id for update;
  return result;
end;
$$;
-- finalize_paypal_topup is intentionally defined by the canonical 20260908000000 migration.
-- Do not redefine it here: the legacy implementation returned public.transactions while the
-- canonical implementation returns jsonb, and PostgreSQL cannot change a function return type
-- with CREATE OR REPLACE FUNCTION.

revoke all on function public.ensure_wallet(uuid) from public;
grant execute on function public.ensure_wallet(uuid) to authenticated, service_role;
revoke all on function public.finalize_paypal_topup(text,text) from public, anon, authenticated;
grant execute on function public.finalize_paypal_topup(text,text) to service_role;
-- Users can inspect only their own wallet/order/transaction records.
drop policy if exists wallets_own on public.wallets;
create policy wallets_own on public.wallets for select to authenticated
  using (user_id = auth.uid());
drop policy if exists transactions_own on public.transactions;
create policy transactions_own on public.transactions for select to authenticated
  using (user_id = auth.uid()::text);
drop policy if exists paypal_orders_own on public.paypal_orders;
create policy paypal_orders_own on public.paypal_orders for select to authenticated
  using (user_id = auth.uid());
-- Webhook events are backend-only.
drop policy if exists paypal_webhook_events_none on public.paypal_webhook_events;
commit;
