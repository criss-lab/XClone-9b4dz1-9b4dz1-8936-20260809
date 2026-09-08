begin;

-- Production PayPal wallet ledger for XClone.
-- Existing wallet schema is preserved (wallets.user_id is text, transactions is the ledger).

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
  values (p_user_id::text, 0, 'KES')
  on conflict (user_id) do nothing;

  select * into result from public.wallets where user_id = p_user_id::text for update;
  return result;
end;
$$;

-- Atomically finalize a PayPal capture. A replay of the same order/capture never credits twice.
create or replace function public.finalize_paypal_topup(p_order_id text, p_capture_id text)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  po public.paypal_orders;
  tx public.transactions;
  w public.wallets;
  old_balance numeric;
  new_balance numeric;
begin
  if coalesce(trim(p_order_id),'') = '' then raise exception 'order_id_required'; end if;
  if coalesce(trim(p_capture_id),'') = '' then raise exception 'capture_id_required'; end if;

  select * into po from public.paypal_orders
  where paypal_order_id = p_order_id
  for update;
  if not found then raise exception 'paypal_order_not_found'; end if;

  if po.capture_id is not null then
    if po.capture_id <> p_capture_id then raise exception 'capture_conflict'; end if;
    if po.transaction_id is null then raise exception 'captured_order_missing_transaction'; end if;
    select * into tx from public.transactions where id = po.transaction_id;
    return tx;
  end if;

  if po.status = 'cancelled' or po.status = 'failed' then
    raise exception 'paypal_order_not_capturable';
  end if;

  if po.transaction_id is null then raise exception 'paypal_order_missing_transaction'; end if;
  select * into tx from public.transactions where id = po.transaction_id for update;
  if not found then raise exception 'transaction_not_found'; end if;

  if tx.user_id <> po.user_id::text then raise exception 'transaction_user_mismatch'; end if;
  if tx.status = 'completed' then
    update public.paypal_orders set capture_id = p_capture_id, status = 'captured', updated_at = now()
    where id = po.id;
    return tx;
  end if;
  if tx.status <> 'pending' then raise exception 'transaction_not_pending'; end if;

  select * into w from public.wallets where user_id = po.user_id::text for update;
  if not found then
    select * into w from public.ensure_wallet(po.user_id);
  end if;

  old_balance := coalesce(w.balance, 0);
  new_balance := old_balance + po.amount;

  update public.wallets
  set balance = new_balance, updated_at = now()
  where id = w.id;

  update public.transactions
  set status = 'completed', type = 'paypal_topup', reference = p_order_id
  where id = tx.id
  returning * into tx;

  update public.paypal_orders
  set capture_id = p_capture_id, status = 'captured', updated_at = now()
  where id = po.id;

  return tx;
end;
$$;

revoke all on function public.ensure_wallet(uuid) from public;
grant execute on function public.ensure_wallet(uuid) to authenticated, service_role;
revoke all on function public.finalize_paypal_topup(text,text) from public, anon, authenticated;
grant execute on function public.finalize_paypal_topup(text,text) to service_role;

-- Users can inspect only their own wallet/order/transaction records.
drop policy if exists wallets_own on public.wallets;
create policy wallets_own on public.wallets for select to authenticated
  using (user_id = auth.uid()::text);

drop policy if exists transactions_own on public.transactions;
create policy transactions_own on public.transactions for select to authenticated
  using (user_id = auth.uid()::text);

drop policy if exists paypal_orders_own on public.paypal_orders;
create policy paypal_orders_own on public.paypal_orders for select to authenticated
  using (user_id = auth.uid());

-- Webhook events are backend-only.
drop policy if exists paypal_webhook_events_none on public.paypal_webhook_events;

commit;
