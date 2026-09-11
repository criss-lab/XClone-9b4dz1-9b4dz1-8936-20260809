-- Atomic, server-authoritative engagement toggles.
-- The canonical production schema uses post_likes/post_reposts.
-- Existing database triggers remain responsible for maintaining post counters.
CREATE UNIQUE INDEX IF NOT EXISTS post_likes_user_post_unique
  ON public.post_likes(user_id, post_id);

CREATE UNIQUE INDEX IF NOT EXISTS post_reposts_user_post_unique
  ON public.post_reposts(user_id, post_id);

CREATE OR REPLACE FUNCTION public.toggle_post_like(p_post_id uuid)
RETURNS TABLE(is_liked boolean, likes_count bigint)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.post_likes
    WHERE user_id = uid AND post_id = p_post_id
  ) THEN
    DELETE FROM public.post_likes
    WHERE user_id = uid AND post_id = p_post_id;
  ELSE
    INSERT INTO public.post_likes(user_id, post_id)
    VALUES (uid, p_post_id)
    ON CONFLICT (user_id, post_id) DO NOTHING;
  END IF;

  RETURN QUERY
  SELECT
    EXISTS (
      SELECT 1 FROM public.post_likes
      WHERE user_id = uid AND post_id = p_post_id
    ),
    (SELECT count(*)::bigint FROM public.post_likes WHERE post_id = p_post_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_post_repost(p_post_id uuid)
RETURNS TABLE(is_reposted boolean, reposts_count bigint)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.post_reposts
    WHERE user_id = uid AND post_id = p_post_id
  ) THEN
    DELETE FROM public.post_reposts
    WHERE user_id = uid AND post_id = p_post_id;
  ELSE
    INSERT INTO public.post_reposts(user_id, post_id)
    VALUES (uid, p_post_id)
    ON CONFLICT (user_id, post_id) DO NOTHING;
  END IF;

  RETURN QUERY
  SELECT
    EXISTS (
      SELECT 1 FROM public.post_reposts
      WHERE user_id = uid AND post_id = p_post_id
    ),
    (SELECT count(*)::bigint FROM public.post_reposts WHERE post_id = p_post_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_post_like(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_post_repost(uuid) TO authenticated;
