-- Production API security hardening.
-- Some deployments start from a minimal Supabase project. Security hardening
-- must therefore skip functions that are not present yet rather than aborting
-- the entire migration chain.
do $$
declare
  sig text;
  revoke_sigs text[] := array[
    'public.bump_post_like_count()',
    'public.bump_post_reply_count()',
    'public.ensure_wallet(uuid)',
    'public.get_personalized_reels(integer, integer)',
    'public.get_unified_feed(integer, integer, text)',
    'public.get_unified_ranked_feed(integer, integer)',
    'public.mark_message_status(uuid, text)',
    'public.notify_social_action()',
    'public.rank_reel_score(uuid, uuid, timestamptz, bigint, bigint, bigint, bigint)',
    'public.record_federated_feed_event(text, text, bigint)',
    'public.record_post_view(uuid)',
    'public.respond_follow_request_atomic(uuid, boolean)',
    'public.set_federated_follow(text, boolean)',
    'public.set_federated_reaction(text, text, boolean)',
    'public.social_sync_post_counters()'
  ];
  search_path_sigs text[] := array[
    'public.ensure_wallet(uuid)',
    'public.get_personalized_reels(integer, integer)',
    'public.get_unified_feed(integer, integer, text)',
    'public.get_unified_ranked_feed(integer, integer)',
    'public.mark_message_status(uuid, text)',
    'public.rank_reel_score(uuid, uuid, timestamptz, bigint, bigint, bigint, bigint)',
    'public.record_federated_feed_event(text, text, bigint)',
    'public.record_post_view(uuid)',
    'public.respond_follow_request_atomic(uuid, boolean)',
    'public.set_federated_follow(text, boolean)',
    'public.set_federated_reaction(text, text, boolean)'
  ];
begin
  foreach sig in array revoke_sigs loop
    if to_regprocedure(sig) is not null then
      execute format('revoke execute on function %s from public, authenticated, anon', sig);
    end if;
  end loop;

  foreach sig in array search_path_sigs loop
    if to_regprocedure(sig) is not null then
      execute format('alter function %s set search_path = public, pg_temp', sig);
    end if;
  end loop;
end
$$;
