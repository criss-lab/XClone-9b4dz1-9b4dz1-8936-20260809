import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

/**
 * Quote-post handoff page.
 * Resolve the source post, then hand the quote context to the canonical
 * composer on Home. Keeping one composer prevents quote posts from being
 * created through a separate/incomplete compose surface.
 */
export default function QuotePage() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!postId) {
        setError(true);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('posts')
        .select('id, content')
        .eq('id', postId)
        .maybeSingle();

      if (!active) return;

      if (fetchError || !data) {
        console.error('[quote-page] source post lookup failed', fetchError);
        setError(true);
        return;
      }

      const params = new URLSearchParams({
        quote_post_id: data.id,
        quote_preview: (data.content ?? '').slice(0, 280),
      });

      navigate(`/?${params.toString()}`, { replace: true });
    })();

    return () => {
      active = false;
    };
  }, [postId, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-muted-foreground">The post to quote could not be found.</p>
          <button className="mt-4 text-primary" onClick={() => navigate(-1)}>
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-7 h-7 animate-spin text-primary" aria-label="Opening post composer" />
    </div>
  );
}
