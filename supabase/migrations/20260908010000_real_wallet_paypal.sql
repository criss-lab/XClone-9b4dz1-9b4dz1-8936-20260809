begin;
create table if not exists public.wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  currency text not null default 'USD' check (currency in ('USD','EUR','GBP','KES')),
  balance numeric(20,2) not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallet_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('deposit','withdrawal','payment','refund','adjustment')),
  direction text not null check (direction in ('credit','debit')),
  amount numeric(20,2) not null check (amount > 0),
  currency text not null check (currency in ('USD','EUR','GBP','KES')),
  status text not null default 'completed' check (status in ('pending','completed','failed','reversed')),
  provider text,
  provider_reference text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists wallet_transactions_provider_ref_uidx
  on public.wallet_transactions(provider, provider_reference)
  where provider is not null and provider_reference is not null;
create index if not exists wallet_transactions_user_created_idx on public.wallet_transactions(user_id, created_at desc);
create table if not exists public.paypal_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paypal_order_id text not null unique,
  paypal_capture_id text,
  amount numeric(20,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency in ('USD','EUR','GBP','KES')),
  status text not null default 'created' check (status in ('created','approved','captured','failed','refunded')),
  approval_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists paypal_orders_user_created_idx on public.paypal_orders(user_id, created_at desc);
alter table public.wallet_accounts enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.paypal_orders enable row level security;
drop policy if exists wallet_accounts_own_select on public.wallet_accounts;
create policy wallet_accounts_own_select on public.wallet_accounts for select to authenticated using (user_id = auth.uid());
drop policy if exists wallet_transactions_own_select on public.wallet_transactions;
create policy wallet_transactions_own_select on public.wallet_transactions for select to authenticated using (user_id = auth.uid());
drop policy if exists paypal_orders_own_select on public.paypal_orders;
create policy paypal_orders_own_select on public.paypal_orders for select to authenticated using (user_id = auth.uid());
create or replace function public.ensure_wallet_account(p_user_id uuid default auth.uid())
returns public.wallet_accounts language plpgsql security definer set search_path=public as $$
declare v public.wallet_accounts;
begin
  if p_user_id is null then raise exception 'Authentication required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden'; end if;
  insert into public.wallet_accounts(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v from public.wallet_accounts where user_id=p_user_id;
  return v;
end; $$;
revoke all on function public.ensure_wallet_account(uuid) from public;
grant execute on function public.ensure_wallet_account(uuid) to authenticated, service_role;
create or replace function public.credit_wallet_paypal(
  p_user_id uuid, p_paypal_order_id text, p_paypal_capture_id text,
  p_amount numeric, p_currency text, p_metadata jsonb default '{}'::jsonb
)
returns public.wallet_accounts language plpgsql security definer set search_path=public as $$
declare v_order public.paypal_orders; v_wallet public.wallet_accounts; v_tx public.wallet_transactions;
begin
  if p_user_id is null or p_paypal_order_id is null or p_paypal_capture_id is null then raise exception 'Invalid PayPal wallet credit request'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  select * into v_order from public.paypal_orders where paypal_order_id=p_paypal_order_id for update;
  if not found then raise exception 'PayPal order not registered'; end if;
  if v_order.user_id <> p_user_id then raise exception 'PayPal order ownership mismatch'; end if;
  if v_order.amount <> round(p_amount::numeric,2) or v_order.currency <> upper(p_currency) then raise exception 'PayPal amount or currency mismatch'; end if;
  if v_order.status='captured' then select * into v_wallet from public.wallet_accounts where user_id=p_user_id; return v_wallet; end if;
  if v_order.status not in ('created','approved') then raise exception 'PayPal order is not capturable'; end if;
  insert into public.wallet_accounts(user_id,currency) values (p_user_id,upper(p_currency)) on conflict (user_id) do nothing;
  select * into v_wallet from public.wallet_accounts where user_id=p_user_id for update;
  insert into public.wallet_transactions(wallet_id,user_id,type,direction,amount,currency,status,provider,provider_reference,description,metadata)
  values(v_wallet.id,p_user_id,'deposit','credit',round(p_amount::numeric,2),upper(p_currency),'completed','paypal',p_paypal_capture_id,'PayPal wallet deposit',coalesce(p_metadata,'{}'::jsonb))
  on conflict (provider,provider_reference) where provider is not null and provider_reference is not null do nothing returning * into v_tx;
  if v_tx.id is not null then
    update public.wallet_accounts set balance=balance+round(p_amount::numeric,2),updated_at=now() where id=v_wallet.id returning * into v_wallet;
  else select * into v_wallet from public.wallet_accounts where id=v_wallet.id; end if;
  update public.paypal_orders set status='captured',paypal_capture_id=p_paypal_capture_id,updated_at=now() where id=v_order.id;
  return v_wallet;
end; $$;
revoke all on function public.credit_wallet_paypal(uuid,text,text,numeric,text,jsonb) from public;
grant execute on function public.credit_wallet_paypal(uuid,text,text,numeric,text,jsonb) to service_role;
create or replace function public.touch_wallet_updated_at() returns trigger language plpgsql security definer set search_path=public as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists trg_wallet_accounts_updated_at on public.wallet_accounts;
create trigger trg_wallet_accounts_updated_at before update on public.wallet_accounts for each row execute function public.touch_wallet_updated_at();
drop trigger if exists trg_paypal_orders_updated_at on public.paypal_orders;
create trigger trg_paypal_orders_updated_at before update on public.paypal_orders for each row execute function public.touch_wallet_updated_at();
commit;
