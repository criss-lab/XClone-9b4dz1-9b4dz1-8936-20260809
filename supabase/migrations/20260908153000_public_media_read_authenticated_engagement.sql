-- Public-read media for public social content; never grant anonymous writes.
-- post_media currently has an authenticated-only SELECT policy, which prevents
-- logged-out visitors from rendering public post media.

alter table public.post_media enable row level security;
create policy post_media_public_read
  on public.post_media
  for select
  to public
  using (true);
-- Keep mutation authority restricted to the authenticated owner.
-- The existing post_media_write policy remains unchanged.;
