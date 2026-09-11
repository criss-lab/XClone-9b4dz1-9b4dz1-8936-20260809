begin;
-- Complete the client authorization contract for tables introduced by the
-- README feature migration. RLS is already enabled; these policies make the
-- intended user-facing operations explicit without exposing financial,
-- moderation, or delivery internals.
-- Production gate touch: keep this migration in the automatic migration path.

-- User-owned settings/preferences -------------------------------------------
drop policy if exists user_settings_own on public.user_settings;
create policy user_settings_own on public.user_settings for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,update,delete on public.user_settings to authenticated;
drop policy if exists feed_preferences_own on public.feed_preferences;
create policy feed_preferences_own on public.feed_preferences for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,update,delete on public.feed_preferences to authenticated;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,update,delete on public.push_subscriptions to authenticated;
drop policy if exists search_queries_own on public.search_queries;
create policy search_queries_own on public.search_queries for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,delete on public.search_queries to authenticated;
drop policy if exists trending_snapshots_read on public.trending_snapshots;
create policy trending_snapshots_read on public.trending_snapshots for select to authenticated using (true);
grant select on public.trending_snapshots to authenticated;
-- Posts/interactions ---------------------------------------------------------
drop policy if exists post_reposts_read on public.post_reposts;
create policy post_reposts_read on public.post_reposts for select to authenticated using (true);
drop policy if exists post_reposts_own on public.post_reposts;
create policy post_reposts_own on public.post_reposts for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,delete on public.post_reposts to authenticated;
drop policy if exists post_shares_read on public.post_shares;
create policy post_shares_read on public.post_shares for select to authenticated
  using (user_id=(select auth.uid()) or user_id is null);
drop policy if exists post_shares_insert on public.post_shares;
create policy post_shares_insert on public.post_shares for insert to authenticated
  with check (user_id=(select auth.uid()) or user_id is null);
grant select,insert on public.post_shares to authenticated;
drop policy if exists post_edits_own on public.post_edits;
create policy post_edits_own on public.post_edits for all to authenticated
  using (editor_id=(select auth.uid())) with check (editor_id=(select auth.uid()));
grant select,insert,delete on public.post_edits to authenticated;
drop policy if exists quote_posts_read on public.quote_posts;
create policy quote_posts_read on public.quote_posts for select to authenticated using (true);
grant select,insert,delete on public.quote_posts to authenticated;
drop policy if exists post_media_read_all on public.post_media;
create policy post_media_read_all on public.post_media for select to authenticated using (true);
drop policy if exists post_media_owner_write on public.post_media;
create policy post_media_owner_write on public.post_media for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
grant select,insert,update,delete on public.post_media to authenticated;
-- Polls ----------------------------------------------------------------------
drop policy if exists polls_read_all on public.polls;
create policy polls_read_all on public.polls for select to authenticated using (true);
drop policy if exists poll_options_read_all on public.poll_options;
create policy poll_options_read_all on public.poll_options for select to authenticated using (true);
drop policy if exists poll_votes_own on public.poll_votes;
create policy poll_votes_own on public.poll_votes for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select on public.polls,public.poll_options to authenticated;
grant select,insert,delete on public.poll_votes to authenticated;
-- Voice/translation/live spaces ---------------------------------------------
drop policy if exists voice_notes_own on public.voice_notes;
create policy voice_notes_own on public.voice_notes for all to authenticated
  using (author_id=(select auth.uid())) with check (author_id=(select auth.uid()));
grant select,insert,update,delete on public.voice_notes to authenticated;
drop policy if exists translations_read on public.post_translations;
create policy translations_read on public.post_translations for select to authenticated using (true);
grant select,insert,update on public.post_translations to authenticated;
drop policy if exists audio_spaces_read on public.audio_spaces;
create policy audio_spaces_read on public.audio_spaces for select to authenticated using (true);
drop policy if exists audio_spaces_host_write on public.audio_spaces;
create policy audio_spaces_host_write on public.audio_spaces for all to authenticated
  using (host_id=(select auth.uid())) with check (host_id=(select auth.uid()));
grant select,insert,update,delete on public.audio_spaces to authenticated;
drop policy if exists space_members_own on public.space_members;
create policy space_members_own on public.space_members for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,delete on public.space_members to authenticated;
-- Communities ----------------------------------------------------------------
drop policy if exists community_posts_read on public.community_posts;
create policy community_posts_read on public.community_posts for select to authenticated using (true);
drop policy if exists community_posts_author_write on public.community_posts;
create policy community_posts_author_write on public.community_posts for all to authenticated
  using (author_id=(select auth.uid())) with check (author_id=(select auth.uid()));
grant select,insert,delete on public.community_posts to authenticated;
-- Privacy/moderation requests ------------------------------------------------
drop policy if exists content_reports_own_insert on public.content_reports;
create policy content_reports_own_insert on public.content_reports for insert to authenticated
  with check (reporter_id=(select auth.uid()));
drop policy if exists content_reports_own_read on public.content_reports;
create policy content_reports_own_read on public.content_reports for select to authenticated
  using (reporter_id=(select auth.uid()));
grant select,insert on public.content_reports to authenticated;
drop policy if exists privacy_preferences_own on public.privacy_preferences;
create policy privacy_preferences_own on public.privacy_preferences for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,update,delete on public.privacy_preferences to authenticated;
drop policy if exists data_export_own on public.data_export_requests;
create policy data_export_own on public.data_export_requests for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert on public.data_export_requests to authenticated;
drop policy if exists account_deletion_own on public.account_deletion_requests;
create policy account_deletion_own on public.account_deletion_requests for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,update on public.account_deletion_requests to authenticated;
-- Analytics/ranking ----------------------------------------------------------
drop policy if exists post_analytics_author_read on public.post_analytics;
create policy post_analytics_author_read on public.post_analytics for select to authenticated
  using (exists(select 1 from public.posts p where p.id=post_id and (p.author_id=(select auth.uid()) or p.user_id=(select auth.uid()))));
grant select on public.post_analytics to authenticated;
drop policy if exists profile_analytics_own on public.profile_analytics_daily;
create policy profile_analytics_own on public.profile_analytics_daily for select to authenticated
  using (user_id=(select auth.uid()));
grant select on public.profile_analytics_daily to authenticated;
drop policy if exists content_events_own on public.content_events;
create policy content_events_own on public.content_events for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,delete on public.content_events to authenticated;
drop policy if exists recommendation_feedback_own on public.recommendation_feedback;
create policy recommendation_feedback_own on public.recommendation_feedback for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,update,delete on public.recommendation_feedback to authenticated;
-- Creator/monetization user visibility --------------------------------------
drop policy if exists creator_earnings_own on public.creator_earnings;
create policy creator_earnings_own on public.creator_earnings for select to authenticated
  using (user_id=(select auth.uid()));
grant select on public.creator_earnings to authenticated;
drop policy if exists subscriptions_participant_read on public.subscriptions;
create policy subscriptions_participant_read on public.subscriptions for select to authenticated
  using (subscriber_id=(select auth.uid()) or creator_id=(select auth.uid()));
grant select on public.subscriptions to authenticated;
drop policy if exists tips_participant_read on public.tips;
create policy tips_participant_read on public.tips for select to authenticated
  using (sender_id=(select auth.uid()) or recipient_id=(select auth.uid()));
drop policy if exists tips_sender_insert on public.tips;
create policy tips_sender_insert on public.tips for insert to authenticated
  with check (sender_id=(select auth.uid()));
grant select,insert on public.tips to authenticated;
drop policy if exists verification_own on public.verification_requests;
create policy verification_own on public.verification_requests for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,update,delete on public.verification_requests to authenticated;
drop policy if exists scheduled_posts_own on public.scheduled_posts;
create policy scheduled_posts_own on public.scheduled_posts for all to authenticated
  using (author_id=(select auth.uid())) with check (author_id=(select auth.uid()));
grant select,insert,update,delete on public.scheduled_posts to authenticated;
drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated using (true);
drop policy if exists products_own on public.products;
create policy products_own on public.products for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
grant select,insert,update,delete on public.products to authenticated;
drop policy if exists post_products_read on public.post_products;
create policy post_products_read on public.post_products for select to authenticated using (true);
drop policy if exists post_products_owner_write on public.post_products;
create policy post_products_owner_write on public.post_products for all to authenticated
  using (exists(select 1 from public.products p where p.id=product_id and p.owner_id=(select auth.uid())))
  with check (exists(select 1 from public.products p where p.id=product_id and p.owner_id=(select auth.uid())));
grant select,insert,delete on public.post_products to authenticated;
-- AI usage -------------------------------------------------------------------
drop policy if exists ai_usage_own_read on public.ai_usage;
create policy ai_usage_own_read on public.ai_usage for select to authenticated
  using (user_id=(select auth.uid()));
grant select on public.ai_usage to authenticated;
-- Federation -----------------------------------------------------------------
drop policy if exists federated_instances_read on public.federated_instances;
create policy federated_instances_read on public.federated_instances for select to authenticated using (true);
drop policy if exists federated_actors_read on public.federated_actors;
create policy federated_actors_read on public.federated_actors for select to authenticated using (true);
drop policy if exists federated_objects_read on public.federated_objects;
create policy federated_objects_read on public.federated_objects for select to authenticated using (true);
drop policy if exists federated_relationships_own on public.federated_relationships;
create policy federated_relationships_own on public.federated_relationships for all to authenticated
  using (local_user_id=(select auth.uid())) with check (local_user_id=(select auth.uid()));
drop policy if exists federated_activities_read on public.federated_activities;
create policy federated_activities_read on public.federated_activities for select to authenticated using (true);
grant select on public.federated_instances,public.federated_actors,public.federated_objects,public.federated_activities to authenticated;
grant select,insert,update,delete on public.federated_relationships to authenticated;
-- Wallet/PayPal: clients may inspect their own ledger/order state, but money
-- movement remains server-side through protected functions/API credentials.
drop policy if exists wallets_own_read on public.wallets;
create policy wallets_own_read on public.wallets for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists wallet_transactions_own_read on public.wallet_transactions;
create policy wallet_transactions_own_read on public.wallet_transactions for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists paypal_orders_own_read on public.paypal_orders;
create policy paypal_orders_own_read on public.paypal_orders for select to authenticated using (user_id=(select auth.uid()));
grant select on public.wallets,public.wallet_transactions,public.paypal_orders to authenticated;
-- Reels ----------------------------------------------------------------------
drop policy if exists reels_read_all on public.reels;
create policy reels_read_all on public.reels for select to authenticated using (true);
drop policy if exists reels_own_write on public.reels;
create policy reels_own_write on public.reels for all to authenticated
  using (author_id=(select auth.uid())) with check (author_id=(select auth.uid()));
drop policy if exists reel_events_own on public.reel_events;
create policy reel_events_own on public.reel_events for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,update,delete on public.reels to authenticated;
grant select,insert,delete on public.reel_events to authenticated;
-- Keep privileged ad/moderation/delivery tables RLS-protected without client
-- grants; service_role bypasses RLS for server-side processing.
revoke all on public.moderation_actions from anon,authenticated;
revoke all on public.ad_sponsorships from anon,authenticated;
revoke all on public.ad_events from anon,authenticated;
revoke all on public.ai_news_sources from anon,authenticated;
revoke all on public.federation_deliveries from anon,authenticated;
notify pgrst, 'reload schema';
commit;
