begin;

update public.posts
set visibility = 'public'
where visibility is distinct from 'public';

alter table public.posts
  alter column visibility set default 'public',
  alter column visibility set not null;

alter table public.posts
  drop constraint if exists posts_visibility_public_only;
alter table public.posts
  add constraint posts_visibility_public_only check (visibility = 'public');

create or replace function public.force_public_post_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.visibility := 'public';
  return new;
end;
$$;

drop trigger if exists force_public_post_visibility on public.posts;
create trigger force_public_post_visibility
before insert or update of visibility on public.posts
for each row execute function public.force_public_post_visibility();

drop policy if exists likes_public_read on public.post_likes;
drop policy if exists post_likes_public_read on public.post_likes;
drop policy if exists likes_read on public.post_likes;
drop policy if exists likes_write_own on public.post_likes;
drop policy if exists post_likes_owner on public.post_likes;
create policy post_likes_authenticated_read on public.post_likes
  for select to authenticated using (true);
create policy post_likes_authenticated_insert on public.post_likes
  for insert to authenticated with check (user_id = auth.uid());
create policy post_likes_authenticated_update on public.post_likes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy post_likes_authenticated_delete on public.post_likes
  for delete to authenticated using (user_id = auth.uid());

commit;