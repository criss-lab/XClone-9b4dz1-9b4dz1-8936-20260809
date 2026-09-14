-- Production-history mirror for migration 20260912021000.
-- Supabase applied the same actor-reconciliation scheduler SQL under generated
-- version 20260912200128. Preserve that immutable production history locally.
do $$ begin
  perform cron.unschedule('testagram-federation-actor-reconciliation');
exception when others then null;
end $$;
select cron.schedule(
  'testagram-federation-actor-reconciliation',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://aepbqfrmheihfsauzcby.supabase.co/functions/v1/federation-reconcile-actors',
      headers := jsonb_build_object('Content-Type','application/json','x-federation-worker-token',(select token from public.federation_worker_config where id=true)),
      body := jsonb_build_object('source','pg_cron-actor-reconciliation','time',now()),
      timeout_milliseconds := 20000
    );
  $$
);
