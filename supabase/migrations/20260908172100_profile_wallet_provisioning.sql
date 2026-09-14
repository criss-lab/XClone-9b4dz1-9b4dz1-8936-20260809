begin;
-- Every profile gets exactly one wallet. The wallet remains server-managed;
-- clients can read their own balance/ledger but cannot mutate financial fields.
create or replace function public.provision_profile_wallet()
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
revoke all on function public.provision_profile_wallet() from public;
drop trigger if exists trg_profiles_provision_wallet on public.profiles;
create trigger trg_profiles_provision_wallet
after insert on public.profiles
for each row execute function public.provision_profile_wallet();
insert into public.wallets (user_id, balance, currency, total_deposited, total_withdrawn)
select p.id, 0, 'USD', 0, 0
from public.profiles p
left join public.wallets w on w.user_id = p.id
where w.id is null
on conflict (user_id) do nothing;
commit;
