begin;
-- Testagram README feature contract.
-- This migration reconciles legacy/partial schemas with the database contract
-- required by the documented social, creator, discovery, moderation,
-- monetization, messaging, federation, and personalization features.
-- It is additive and idempotent: existing data is preserved.

-- Core post compatibility -----------------------------------------------------
alter table if exists public.posts add column if not exists media_url text;
alter table if exists public.posts add column if not exists media_type text;
alter table if exists public.posts add column if not exists like_count bigint not null default 0;
alter table if exists public.posts add column if not exists reply_count bigint not null default 0;
alter table if exists public.posts add column if not exists repost_count bigint not null default 0;
alter table if exists public.posts add column if not exists view_count bigint not null default 0;
alter table if exists public.posts add column if not exists share_count bigint not null default 0;
alter table if exists public.posts add column if not exists quote_post_id uuid;
alter table if exists public.posts add column if not exists language_code text;
alter table if exists public.posts add column if not exists edited_at timestamptz;
alter table if exists public.posts add column if not exists deleted_at timestamptz;
update public.posts set media_url = coalesce(media_url, image_url, video_url) where media_url is null;
update public.posts set like_count = likes_count where like_count = 0 and likes_count <> 0;
update public.posts set reply_count = replies_count where reply_count = 0 and replies_count <> 0;
update public.posts set repost_count = reposts_count where repost_count = 0 and repost_count <> 0;
update public.posts set view_count = views_count where view_count = 0 and views_count <> 0;
create table if not exists public.post_reposts (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(post_id,user_id)
);
create index if not exists post_reposts_post_idx on public.post_reposts(post_id,created_at desc);
create index if not exists post_reposts_user_idx on public.post_reposts(user_id,created_at desc);
create table if not exists public.post_shares (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  channel text not null default 'native',
  created_at timestamptz not null default now()
);
create index if not exists post_shares_post_idx on public.post_shares(post_id,created_at desc);
create table if not exists public.post_edits (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  editor_id uuid not null references public.profiles(id) on delete cascade,
  previous_content text not null default '',
  previous_media_urls jsonb not null default '[]'::jsonb,
  edited_at timestamptz not null default now()
);
create index if not exists post_edits_post_idx on public.post_edits(post_id,edited_at desc);
create table if not exists public.quote_posts (
  post_id uuid primary key references public.posts(id) on delete cascade,
  quoted_post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  check(post_id <> quoted_post_id)
);
-- Profile/settings/feed preferences -----------------------------------------
alter table if exists public.profiles add column if not exists cover_url text;
alter table if exists public.profiles add column if not exists social_links jsonb not null default '{}'::jsonb;
alter table if exists public.profiles add column if not exists verified_tier text not null default 'none';
alter table if exists public.profiles add column if not exists profile_views bigint not null default 0;
create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'system',
  language_code text not null default 'en',
  autoplay_video boolean not null default true,
  reduced_motion boolean not null default false,
  feed_mode text not null default 'for_you',
  email_notifications boolean not null default true,
  push_notifications boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.feed_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  chronological boolean not null default false,
  show_sensitive boolean not null default false,
  muted_topics text[] not null default '{}',
  muted_words text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text,
  auth_key text,
  platform text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(user_id,endpoint)
);
-- Discovery/trending/search --------------------------------------------------
create table if not exists public.search_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  query text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists search_queries_user_idx on public.search_queries(user_id,created_at desc);
create table if not exists public.trending_snapshots (
  id uuid primary key default gen_random_uuid(),
  tag text not null,
  "window" text not null check("window" in ('hour','day')),
  score numeric(18,6) not null default 0,
  post_count bigint not null default 0,
  captured_at timestamptz not null default now(),
  unique(tag,"window",captured_at)
);
create index if not exists trending_snapshots_window_idx on public.trending_snapshots("window",score desc,captured_at desc);
-- Communities ----------------------------------------------------------------
alter table if exists public.communities add column if not exists created_by uuid;
alter table if exists public.communities add column if not exists owner_id uuid;
alter table if exists public.communities add column if not exists member_count bigint not null default 0;
update public.communities set created_by=owner_id where created_by is null and owner_id is not null;
update public.communities set owner_id=created_by where owner_id is null and created_by is not null;
alter table if exists public.community_members add column if not exists status text not null default 'active';
create table if not exists public.community_posts (
  community_id uuid not null references public.communities(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(community_id,post_id)
);
-- Polls, media, voice, translation ------------------------------------------
create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  media_url text not null,
  media_type text not null check(media_type in ('image','video','gif','audio','voice')),
  mime_type text,
  byte_size bigint not null default 0 check(byte_size between 0 and 20971520),
  width integer,
  height integer,
  duration_ms bigint,
  sort_order smallint not null default 0 check(sort_order between 0 and 3),
  created_at timestamptz not null default now(),
  unique(post_id,sort_order)
);
create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  expires_at timestamptz,
  multiple_choice boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label text not null,
  vote_count bigint not null default 0,
  sort_order smallint not null default 0,
  unique(poll_id,sort_order)
);
create table if not exists public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(poll_id,option_id,user_id)
);
create table if not exists public.voice_notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  media_url text not null,
  duration_ms bigint not null check(duration_ms between 1 and 600000),
  transcript text,
  created_at timestamptz not null default now()
);
create table if not exists public.post_translations (
  post_id uuid not null references public.posts(id) on delete cascade,
  language_code text not null,
  translated_body text not null,
  created_at timestamptz not null default now(),
  primary key(post_id,language_code)
);
-- Messaging and live spaces --------------------------------------------------
create table if not exists public.audio_spaces (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  status text not null default 'scheduled' check(status in ('scheduled','live','ended')),
  listener_count bigint not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  recording_url text,
  recording_expires_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.space_members (
  space_id uuid not null references public.audio_spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'listener' check(role in ('listener','speaker','cohost')),
  joined_at timestamptz not null default now(),
  primary key(space_id,user_id)
);
alter table if exists public.messages add column if not exists body text;
alter table if exists public.messages add column if not exists edited_at timestamptz;
alter table if exists public.messages add column if not exists deleted_at timestamptz;
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name = 'content'
  ) then
    execute 'update public.messages set body=content where body is null and content is not null';
  end if;
end $$;
-- Moderation/privacy ---------------------------------------------------------
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete cascade,
  reason text not null,
  details text not null default '',
  status text not null default 'open' check(status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists content_reports_status_idx on public.content_reports(status,created_at desc);
create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  action text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.privacy_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  discoverable boolean not null default true,
  allow_messages boolean not null default true,
  allow_mentions boolean not null default true,
  allow_personalized_ranking boolean not null default true,
  analytics_opt_out boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.data_export_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'requested' check(status in ('requested','processing','ready','failed','expired')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz,
  object_key text
);
create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'requested' check(status in ('requested','processing','cancelled','completed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
-- Analytics/ranking ----------------------------------------------------------
create table if not exists public.post_analytics (
  post_id uuid primary key references public.posts(id) on delete cascade,
  views bigint not null default 0,
  likes bigint not null default 0,
  replies bigint not null default 0,
  reposts bigint not null default 0,
  shares bigint not null default 0,
  engagement_rate numeric(10,5) not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.profile_analytics_daily (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  profile_views bigint not null default 0,
  impressions bigint not null default 0,
  engagements bigint not null default 0,
  primary key(user_id,day)
);
create table if not exists public.content_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  event_type text not null,
  dwell_ms bigint not null default 0,
  created_at timestamptz not null default now(),
  check(post_id is not null)
);
create index if not exists content_events_rank_idx on public.content_events(post_id,created_at desc);
create table if not exists public.recommendation_feedback (
  user_id uuid not null references public.profiles(id) on delete cascade,
  topic text not null,
  action text not null check(action in('boost','reduce','mute')),
  weight numeric(8,3) not null default 1,
  updated_at timestamptz not null default now(),
  primary key(user_id,topic)
);
-- Creator tools and monetization --------------------------------------------
create table if not exists public.creator_earnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null,
  amount_cents bigint not null default 0 check(amount_cents>=0),
  currency text not null default 'USD',
  status text not null default 'pending' check(status in('pending','available','paid','reversed')),
  created_at timestamptz not null default now()
);
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.profiles(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  tier text not null default 'basic',
  status text not null default 'active' check(status in('active','paused','cancelled')),
  provider text,
  provider_ref text,
  created_at timestamptz not null default now(),
  unique(subscriber_id,creator_id)
);
create table if not exists public.tips (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents bigint not null check(amount_cents>0),
  currency text not null default 'USD',
  provider text,
  provider_ref text,
  status text not null default 'pending' check(status in('pending','completed','failed','refunded')),
  created_at timestamptz not null default now()
);
create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tier text not null check(tier in('basic','premium','vip')),
  status text not null default 'pending' check(status in('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create table if not exists public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  media_urls jsonb not null default '[]'::jsonb,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check(status in('scheduled','published','cancelled','failed')),
  created_at timestamptz not null default now()
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text not null default '',
  image_url text,
  external_url text,
  price_cents bigint,
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);
create table if not exists public.post_products (
  post_id uuid not null references public.posts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key(post_id,product_id)
);
create table if not exists public.ad_sponsorships (
  id uuid primary key default gen_random_uuid(),
  sponsor_name text not null,
  post_id uuid references public.posts(id) on delete cascade,
  creator_id uuid references public.profiles(id) on delete set null,
  status text not null default 'draft' check(status in('draft','active','paused','completed')),
  budget_cents bigint not null default 0 check(budget_cents>=0),
  created_at timestamptz not null default now()
);
create table if not exists public.ad_events (
  id uuid primary key default gen_random_uuid(),
  sponsorship_id uuid not null references public.ad_sponsorships(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check(event_type in('impression','click')),
  created_at timestamptz not null default now()
);
-- AI infrastructure ----------------------------------------------------------
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  feature text not null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost_micros bigint not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.ai_news_sources (
  id uuid primary key default gen_random_uuid(),
  source_url text not null unique,
  title text,
  fetched_at timestamptz,
  published_at timestamptz,
  processed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
);
-- Federation / ActivityPub ---------------------------------------------------
create table if not exists public.federated_instances (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  protocol text not null default 'activitypub',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.federated_actors (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid references public.federated_instances(id) on delete set null,
  uri text not null unique,
  preferred_username text,
  display_name text,
  avatar_url text,
  inbox_url text,
  outbox_url text,
  raw_actor jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.federated_objects (
  id uuid primary key default gen_random_uuid(),
  uri text not null unique,
  object_type text not null,
  actor_uri text,
  content text,
  published_at timestamptz,
  in_reply_to_uri text,
  quote_uri text,
  attachments jsonb not null default '[]'::jsonb,
  raw_object jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.federated_relationships (
  id uuid primary key default gen_random_uuid(),
  local_user_id uuid not null references public.profiles(id) on delete cascade,
  remote_actor_uri text not null,
  relationship text not null check(relationship in('following','follower','blocked','muted')),
  state text not null default 'pending',
  created_at timestamptz not null default now(),
  unique(local_user_id,remote_actor_uri,relationship)
);
create table if not exists public.federated_activities (
  id uuid primary key default gen_random_uuid(),
  uri text not null unique,
  activity_type text not null,
  actor_uri text not null,
  object_uri text,
  raw_activity jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create table if not exists public.federation_deliveries (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.federated_activities(id) on delete cascade,
  target_inbox text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz,
  unique(activity_id,target_inbox)
);
-- PayPal wallet/payment records ---------------------------------------------
create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_cents bigint not null default 0 check(balance_cents>=0),
  currency text not null default 'USD',
  updated_at timestamptz not null default now()
);
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  amount_cents bigint not null check(amount_cents>0),
  currency text not null default 'USD',
  direction text not null check(direction in('credit','debit')),
  status text not null default 'pending',
  provider text,
  provider_order_id text,
  provider_capture_id text,
  created_at timestamptz not null default now()
);
create table if not exists public.paypal_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  wallet_transaction_id uuid not null references public.wallet_transactions(id) on delete cascade,
  paypal_order_id text not null unique,
  amount_cents bigint not null check(amount_cents>0),
  currency text not null default 'USD',
  status text not null default 'created',
  approval_url text,
  created_at timestamptz not null default now(),
  captured_at timestamptz
);
-- Live reels/recommendation support -----------------------------------------
create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  video_url text not null,
  caption text not null default '',
  duration_ms bigint not null default 1,
  width integer,
  height integer,
  view_count bigint not null default 0,
  like_count bigint not null default 0,
  share_count bigint not null default 0,
  comment_count bigint not null default 0,
  completion_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.reel_events (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  watch_ms bigint not null default 0,
  session_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists reel_events_rank_idx on public.reel_events(reel_id,created_at desc);
-- RLS for user-owned feature tables. Service-role/admin processing remains
-- outside these policies; client users only see or mutate their own records.
do $$
declare t text;
begin
  foreach t in array array[
    'post_reposts','post_shares','post_edits','quote_posts','user_settings',
    'feed_preferences','push_subscriptions','search_queries','trending_snapshots',
    'community_posts','post_media','polls','poll_options','poll_votes','voice_notes',
    'post_translations','audio_spaces','space_members','content_reports',
    'moderation_actions','privacy_preferences','data_export_requests','account_deletion_requests',
    'post_analytics','profile_analytics_daily','content_events','recommendation_feedback',
    'creator_earnings','subscriptions','tips','verification_requests','scheduled_posts',
    'products','post_products','ad_sponsorships','ad_events','ai_usage','ai_news_sources',
    'federated_instances','federated_actors','federated_objects','federated_relationships',
    'federated_activities','federation_deliveries','wallets','wallet_transactions','paypal_orders',
    'reels','reel_events'
  ] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;
-- Realtime-safe metadata invalidation after the additive schema reconciliation.
notify pgrst, 'reload schema';
commit;
