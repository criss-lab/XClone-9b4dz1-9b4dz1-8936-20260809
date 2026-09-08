begin;

alter table if exists public.posts add column if not exists user_id uuid;
alter table if exists public.posts add column if not exists author_id uuid;

do $$
begin
  if to_regclass('public.posts') is not null then
    if not exists (select 1 from pg_constraint where conname = 'posts_user_id_fkey') then
      begin
        alter table public.posts add constraint posts_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
      exception when duplicate_object then null;
      end;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'posts_author_id_fkey') then
      begin
        alter table public.posts add constraint posts_author_id_fkey foreign key (author_id) references auth.users(id) on delete cascade;
      exception when duplicate_object then null;
      end;
    end if;
    create or replace function public.sync_post_owner_columns()
    returns trigger language plpgsql security definer set search_path = '' as $fn$
    begin
      if new.author_id is null and new.user_id is not null then new.author_id := new.user_id; end if;
      if new.user_id is null and new.author_id is not null then new.user_id := new.author_id; end if;
      if new.author_id is null then raise exception 'posts.author_id/user_id is required'; end if;
      return new;
    end;
    $fn$;
    drop trigger if exists trg_sync_post_owner_columns on public.posts;
    create trigger trg_sync_post_owner_columns before insert or update on public.posts for each row execute function public.sync_post_owner_columns();
    revoke all on function public.sync_post_owner_columns() from public;
  end if;
end $$;

do $$
declare verified_expr text := 'null::boolean as verified';
begin
  if to_regclass('public.user_profiles') is null and to_regclass('public.profiles') is not null then
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='verified') then
      verified_expr := 'coalesce(verified, false) as verified';
    end if;
    execute format($v$create view public.user_profiles with (security_invoker = true) as select id, username, display_name, avatar_url, bio, website, location, %s from public.profiles$v$, verified_expr);
  end if;
end $$;

do $$
begin
  if to_regclass('public.user_settings') is not null then
    execute 'grant select, insert, update, delete on public.user_settings to authenticated';
    execute 'alter table public.user_settings enable row level security';
  end if;
  if to_regclass('public.user_devices') is not null then
    execute 'grant select, insert, update, delete on public.user_devices to authenticated';
    execute 'alter table public.user_devices enable row level security';
  end if;
end $$;

do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'grant select on public.profiles to anon, authenticated';
    execute 'grant insert, update, delete on public.profiles to authenticated';
    execute 'alter table public.profiles enable row level security';
    drop policy if exists profiles_public_read on public.profiles;
    drop policy if exists profiles_owner_insert on public.profiles;
    drop policy if exists profiles_owner_update on public.profiles;
    drop policy if exists profiles_owner_delete on public.profiles;
    create policy profiles_public_read on public.profiles for select to anon, authenticated using (true);
    create policy profiles_owner_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
    create policy profiles_owner_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
    create policy profiles_owner_delete on public.profiles for delete to authenticated using (id = (select auth.uid()));
  end if;
end $$;

do $$
begin
  if to_regclass('public.posts') is not null then
    execute 'grant select on public.posts to anon, authenticated';
    execute 'grant insert, update, delete on public.posts to authenticated';
    execute 'alter table public.posts enable row level security';
    drop policy if exists posts_public_read on public.posts;
    drop policy if exists posts_owner_insert on public.posts;
    drop policy if exists posts_owner_update on public.posts;
    drop policy if exists posts_owner_delete on public.posts;
    create policy posts_public_read on public.posts for select to anon, authenticated using (true);
    create policy posts_owner_insert on public.posts for insert to authenticated with check (author_id = (select auth.uid()) or user_id = (select auth.uid()));
    create policy posts_owner_update on public.posts for update to authenticated using (author_id = (select auth.uid()) or user_id = (select auth.uid())) with check (author_id = (select auth.uid()) or user_id = (select auth.uid()));
    create policy posts_owner_delete on public.posts for delete to authenticated using (author_id = (select auth.uid()) or user_id = (select auth.uid()));
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['follows','follow_requests','user_blocks','mutes','post_likes','post_views','bookmarks','mentions','user_interests'] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end if;
  end loop;
  if to_regclass('public.follows') is not null then
    drop policy if exists follows_public_read on public.follows;
    drop policy if exists follows_owner_write on public.follows;
    create policy follows_public_read on public.follows for select to anon, authenticated using (true);
    create policy follows_owner_write on public.follows for all to authenticated using (follower_id = (select auth.uid())) with check (follower_id = (select auth.uid()));
  end if;
  if to_regclass('public.follow_requests') is not null then
    drop policy if exists follow_requests_participant_read on public.follow_requests;
    drop policy if exists follow_requests_participant_write on public.follow_requests;
    create policy follow_requests_participant_read on public.follow_requests for select to authenticated using (requester_id = (select auth.uid()) or target_id = (select auth.uid()));
    create policy follow_requests_participant_write on public.follow_requests for all to authenticated using (requester_id = (select auth.uid()) or target_id = (select auth.uid())) with check (requester_id = (select auth.uid()) or target_id = (select auth.uid()));
  end if;
  if to_regclass('public.user_blocks') is not null then
    drop policy if exists user_blocks_owner on public.user_blocks;
    create policy user_blocks_owner on public.user_blocks for all to authenticated using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));
  end if;
  if to_regclass('public.mutes') is not null then
    drop policy if exists mutes_owner on public.mutes;
    create policy mutes_owner on public.mutes for all to authenticated using (muter_id = (select auth.uid())) with check (muter_id = (select auth.uid()));
  end if;
  foreach t in array array['post_likes','post_views','bookmarks','user_interests'] loop
    if to_regclass('public.'||t) is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='user_id') then
      execute format('drop policy if exists %I on public.%I', t||'_owner', t);
      execute format('create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t||'_owner', t);
    end if;
  end loop;
  if to_regclass('public.mentions') is not null then
    drop policy if exists mentions_public_read on public.mentions;
    create policy mentions_public_read on public.mentions for select to anon, authenticated using (true);
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='mentions' and column_name='post_id') then
      drop policy if exists mentions_post_owner_write on public.mentions;
      create policy mentions_post_owner_write on public.mentions for all to authenticated using (exists(select 1 from public.posts p where p.id = post_id and (p.author_id = (select auth.uid()) or p.user_id = (select auth.uid())))) with check (exists(select 1 from public.posts p where p.id = post_id and (p.author_id = (select auth.uid()) or p.user_id = (select auth.uid()))));
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.post_replies') is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name='post_replies' and column_name='author_id') then
    execute 'grant select on public.post_replies to anon, authenticated';
    execute 'grant insert, update, delete on public.post_replies to authenticated';
    execute 'alter table public.post_replies enable row level security';
    drop policy if exists post_replies_public_read on public.post_replies;
    drop policy if exists post_replies_owner_write on public.post_replies;
    create policy post_replies_public_read on public.post_replies for select to anon, authenticated using (true);
    create policy post_replies_owner_write on public.post_replies for all to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
  end if;
end $$;

do $$
declare recipient_expr text := null;
begin
  if to_regclass('public.notifications') is not null then
    execute 'grant select, update, delete on public.notifications to authenticated';
    execute 'alter table public.notifications enable row level security';
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='recipient_id') then recipient_expr := 'recipient_id = (select auth.uid())';
    elsif exists(select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='user_id') then recipient_expr := 'user_id = (select auth.uid())'; end if;
    if recipient_expr is not null then
      drop policy if exists notifications_recipient_read on public.notifications;
      drop policy if exists notifications_recipient_update on public.notifications;
      drop policy if exists notifications_recipient_delete on public.notifications;
      execute format('create policy notifications_recipient_read on public.notifications for select to authenticated using (%s)', recipient_expr);
      execute format('create policy notifications_recipient_update on public.notifications for update to authenticated using (%s) with check (%s)', recipient_expr, recipient_expr);
      execute format('create policy notifications_recipient_delete on public.notifications for delete to authenticated using (%s)', recipient_expr);
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.hashtags') is not null then
    execute 'grant select, insert on public.hashtags to authenticated';
    execute 'grant select on public.hashtags to anon';
    execute 'alter table public.hashtags enable row level security';
    drop policy if exists hashtags_public_read on public.hashtags;
    drop policy if exists hashtags_authenticated_insert on public.hashtags;
    create policy hashtags_public_read on public.hashtags for select to anon, authenticated using (true);
    create policy hashtags_authenticated_insert on public.hashtags for insert to authenticated with check (true);
  end if;
end $$;

do $$
begin
  if to_regclass('public.media_assets') is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name='media_assets' and column_name='owner_id') then
    execute 'grant select, insert, update, delete on public.media_assets to authenticated';
    execute 'alter table public.media_assets enable row level security';
    drop policy if exists media_assets_owner_read on public.media_assets;
    drop policy if exists media_assets_owner_write on public.media_assets;
    create policy media_assets_owner_read on public.media_assets for select to authenticated using (owner_id = (select auth.uid()));
    create policy media_assets_owner_write on public.media_assets for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end $$;

commit;
