create or replace function public.cleanup_expired_federation_interactions() returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.federation_remote_engagements where expires_at is not null and expires_at < now();
  delete from public.federation_remote_bookmarks where expires_at is not null and expires_at < now();
  delete from public.federation_remote_quotes where expires_at is not null and expires_at < now();
  delete from public.federation_remote_replies where expires_at is not null and expires_at < now();
  delete from public.federation_remote_reposts where expires_at is not null and expires_at < now();
  delete from public.federation_remote_likes where expires_at is not null and expires_at < now();
  delete from public.federation_remote_interactions where expires_at is not null and expires_at < now();
end;
$$;
revoke all on function public.cleanup_expired_federation_interactions() from public;
select cron.unschedule('testagram-federation-interaction-cleanup') where exists (select 1 from cron.job where jobname='testagram-federation-interaction-cleanup');
select cron.schedule('testagram-federation-interaction-cleanup','15 * * * *',$$select public.cleanup_expired_federation_interactions();$$);
