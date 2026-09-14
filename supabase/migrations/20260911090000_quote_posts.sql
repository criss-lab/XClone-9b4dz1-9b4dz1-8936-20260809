-- Native quote-post support: preserve the original post relationship instead of
-- relying on a text-only preview in the composer URL.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS quoted_post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS posts_quoted_post_id_idx
  ON public.posts(quoted_post_id)
  WHERE quoted_post_id IS NOT NULL;
