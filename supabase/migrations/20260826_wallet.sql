-- Wallet table (production persistence layer)

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  user_id text unique not null,
  balance numeric default 0,
  currency text default 'KES',
  created_at timestamp default now(),
  updated_at timestamp default now()
);
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  amount numeric not null,
  type text not null,
  reference text,
  status text default 'pending',
  created_at timestamp default now()
);
create index if not exists idx_wallet_user on wallets(user_id);
create index if not exists idx_tx_user on transactions(user_id);
