begin;
-- Surgical security fix: media must belong to the author of the post it is
-- attached to. The previous owner-only policy allowed an authenticated user
-- to attach their own media row to another user's post by supplying a foreign
-- post_id. Do not change read visibility here; only tighten write ownership.
drop policy if exists post_media_write on public.post_media;
drop policy if exists post_media_owner_write on public.post_media;
grant select, insert, update, delete on public.post_media to authenticated;
create policy post_media_owner_write on public.post_media
for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.posts p
    where p.id = post_media.post_id
      and (p.author_id = (select auth.uid()) or p.user_id = (select auth.uid()))
  )
)
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.posts p
    where p.id = post_media.post_id
      and (p.author_id = (select auth.uid()) or p.user_id = (select auth.uid()))
  )
);
commit;
