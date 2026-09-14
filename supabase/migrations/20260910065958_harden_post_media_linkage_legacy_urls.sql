begin;

-- Re-run media normalization for legacy posts that stored only image_url/video_url.
update public.posts
set media_urls = coalesce(media_urls, '[]'::jsonb)
where coalesce(image_url,'') <> '' or coalesce(video_url,'') <> '';

notify pgrst, 'reload schema';
commit;
