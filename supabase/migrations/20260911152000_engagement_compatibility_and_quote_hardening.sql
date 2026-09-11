-- Compatibility bridge for legacy client paths while the canonical schema remains post_likes/post_reposts.
-- Do not create legacy views: production post_likes/post_reposts use engagement_id, not id.
-- Keep canonical tables authoritative and expose compatibility through count columns only.

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS likes_count bigint NOT NULL DEFAULT 0;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS reposts_count bigint NOT NULL DEFAULT 0;

UPDATE public.posts p
SET likes_count = COALESCE(p.like_count, 0),
    reposts_count = COALESCE(p.repost_count, 0);

CREATE OR REPLACE FUNCTION public.sync_legacy_engagement_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_post_id uuid;
BEGIN
  affected_post_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;

  UPDATE public.posts p
  SET likes_count = (SELECT count(*) FROM public.post_likes l WHERE l.post_id = affected_post_id),
      reposts_count = (SELECT count(*) FROM public.post_reposts r WHERE r.post_id = affected_post_id)
  WHERE p.id = affected_post_id;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS sync_legacy_like_counts ON public.post_likes;
CREATE TRIGGER sync_legacy_like_counts
AFTER INSERT OR DELETE ON public.post_likes
FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_engagement_counts();

DROP TRIGGER IF EXISTS sync_legacy_repost_counts ON public.post_reposts;
CREATE TRIGGER sync_legacy_repost_counts
AFTER INSERT OR DELETE ON public.post_reposts
FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_engagement_counts();
