drop trigger if exists profiles_wallet_bootstrap on public.profiles;
drop trigger if exists trg_profile_wallet on public.profiles;
drop trigger if exists trg_profiles_provision_wallet on public.profiles;
drop trigger if exists profiles_provision_wallet on public.profiles;
create trigger profiles_provision_wallet after insert on public.profiles for each row execute function public.provision_profile_wallet();
