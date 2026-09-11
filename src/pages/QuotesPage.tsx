import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Loader2, Quote } from 'lucide-react';
import { PostCard } from '@/components/features/PostCard';

export default function QuotesPage() {
  const { postId } = useParams<{ postId: string }>();
  const [original, setOriginal] = useState<any>(null);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!postId) return;
      setLoading(true);
      setError(null);
      const [{ data: source, error: sourceError }, { data: quoteRows, error: quoteError }] = await Promise.all([
        supabase.from('posts').select('*').eq('id', postId).maybeSingle(),
        supabase.from('posts').select('*').eq('quoted_post_id', postId).order('created_at', { ascending: false }),
      ]);
      if (!active) return;
      if (sourceError || quoteError) setError((sourceError || quoteError)?.message || 'Unable to load quotes');
      setOriginal(source || null);
      setQuotes(quoteRows || []);
      setLoading(false);
    };
    load();
    return () => { active = false; };
  }, [postId]);

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (error) return <div className="p-6 text-sm text-muted-foreground">{error}</div>;
  if (!original) return <div className="p-6 text-sm text-muted-foreground">Original post unavailable.</div>;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <header className="flex items-center gap-2"><Quote className="h-5 w-5" /><h1 className="text-xl font-semibold">Quotes</h1></header>
      <section className="rounded-xl border p-4"><PostCard post={original} /></section>
      <section className="space-y-3">
        {quotes.length === 0 ? <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">No quotes yet.</div> : quotes.map((post) => <PostCard key={post.id} post={post} />)}
      </section>
    </main>
  );
}
