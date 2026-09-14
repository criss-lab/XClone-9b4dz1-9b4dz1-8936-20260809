-- Infinite threaded replies: every reply is a post that may itself be replied to.
-- The self-reference intentionally has no depth limit.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS reply_to_post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS posts_reply_to_post_idx
  ON public.posts(reply_to_post_id, created_at ASC);

-- Keep a fast direct-reply counter without restricting nesting depth.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS reply_count bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.sync_post_reply_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_id uuid;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.reply_to_post_id ELSE NEW.reply_to_post_id END;
  IF parent_id IS NOT NULL THEN
    UPDATE public.posts
    SET reply_count = (SELECT count(*) FROM public.posts child WHERE child.reply_to_post_id = parent_id)
    WHERE id = parent_id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS posts_reply_count_sync ON public.posts;
CREATE TRIGGER posts_reply_count_sync
AFTER INSERT OR DELETE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.sync_post_reply_count();

-- Existing authenticated users can read replies and create replies as their own posts.
DROP POLICY IF EXISTS posts_replies_read ON public.posts;
CREATE POLICY posts_replies_read ON public.posts
FOR SELECT TO authenticated USING (true);

COMMENT ON COLUMN public.posts.reply_to_post_id IS 'Parent post ID; supports arbitrarily deep reply chains.';
