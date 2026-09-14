-- Production-history mirror for migration 20260912020000.
-- The SQL was already applied to production under Supabase-generated version
-- 20260912195657. Keep the exact remote version represented locally so the
-- release migration gate does not rewrite or falsely revert production history.
do $$ begin
  perform cron.unschedule('testagram-federation-worker');
exception when others then null;
end $$;
select cron.schedule(
  'testagram-federation-processing-worker',
  '15 seconds',
  $$
    select net.http_post(
      url := 'https://aepbqfrmheihfsauzcby.supabase.co/functions/v1/federation-processing-worker?limit=50',
      headers := jsonb_build_object('Content-Type','application/json','x-federation-worker-token',(select token from public.federation_worker_config where id=true)),
      body := jsonb_build_object('source','pg_cron-processing','time',now()),
      timeout_milliseconds := 10000
    );
  $$
);
select cron.schedule(
  'testagram-federation-delivery-worker',
  '30 seconds',
  $$
    select net.http_post(
      url := 'https://aepbqfrmheihfsauzcby.supabase.co/functions/v1/federation-delivery-worker?limit=50',
      headers := jsonb_build_object('Content-Type','application/json','x-federation-worker-token',(select token from public.federation_worker_config where id=true)),
      body := jsonb_build_object('source','pg_cron-delivery','time',now()),
      timeout_milliseconds := 10000
    );
  $$
);
