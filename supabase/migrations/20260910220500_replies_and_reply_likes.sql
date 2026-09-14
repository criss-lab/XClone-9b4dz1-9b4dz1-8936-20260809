begin;

create table if not exists public.replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists replies_post_created_idx on public.replies(post_id, created_at asc);
create index if not exists replies_user_idx on public.replies(user_id, created_at desc);

create table if not exists public.reply_likes (
  reply_id uuid not null references public.replies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(reply_id, user_id)
);

create index if not exists reply_likes_user_idx on public.reply_likes(user_id, created_at desc);

alter table public.replies enable row level security;
alter table public.reply_likes enable row level security;

drop policy if exists replies_public_read on public.replies;
drop policy if exists replies_authenticated_insert on public.replies;
drop policy if exists replies_authenticated_update on public.replies;
drop policy if exists replies_authenticated_delete on public.replies;
create policy replies_public_read on public.replies for select to anon, authenticated using (true);
create policy replies_authenticated_insert on public.replies for insert to authenticated with check (user_id = auth.uid());
create policy replies_authenticated_update on public.replies for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy replies_authenticated_delete on public.replies for delete to authenticated using (user_id = auth.uid());

drop policy if exists reply_likes_authenticated_read on public.reply_likes;
drop policy if exists reply_likes_authenticated_insert on public.reply_likes;
drop policy if exists reply_likes_authenticated_delete on public.reply_likes;
create policy reply_likes_authenticated_read on public.reply_likes for select to authenticated using (true);
create policy reply_likes_authenticated_insert on public.reply_likes for insert to authenticated with check (user_id = auth.uid());
create policy reply_likes_authenticated_delete on public.reply_likes for delete to authenticated using (user_id = auth.uid());

create or replace function public.bump_post_reply_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    update public.posts set replies_count = coalesce(replies_count, 0) + 1 where id = new.post_id;
  elsif TG_OP = 'DELETE' then
    update public.posts set replies_count = greatest(0, coalesce(replies_count, 0) - 1) where id = old.post_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists replies_post_counter on public.replies;
create trigger replies_post_counter after insert or delete on public.replies for each row execute function public.bump_post_reply_count();

notify pgrst, 'reload schema';

commit;