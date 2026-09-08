begin;

-- Every application profile owns exactly one wallet.
-- The live wallets table uses auth.users/profiles UUIDs and enforces one wallet per user.
create unique index if not exists wallets_user_id_unique_idx on public.wallets(user_id);

create or replace function public.create_profile_wallet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wallets (user_id, balance, currency, total_deposited, total_withdrawn)
  values (new.id, 0, 'USD', 0, 0)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_profile_wallet() from public;

drop trigger if exists profiles_wallet_bootstrap on public.profiles;
create trigger profiles_wallet_bootstrap
after insert on public.profiles
for each row execute function public.create_profile_wallet();

-- Repair any existing profiles that do not have a wallet.
insert into public.wallets (user_id, balance, currency, total_deposited, total_withdrawn)
select p.id, 0, 'USD', 0, 0
from public.profiles p
left join public.wallets w on w.user_id = p.id
where w.id is null
on conflict (user_id) do nothing;

commit;
