revoke all on function public.create_profile_wallet() from public, anon, authenticated;
revoke all on function public.ensure_wallet_account(uuid) from public, anon, authenticated;
revoke all on function public.touch_wallet_updated_at() from public, anon, authenticated;
