alter table public.wallets
  add column if not exists paypal_email text;
