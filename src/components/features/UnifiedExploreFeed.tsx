import { useCallback, useEffect, useState } from 'react';
import { Globe, Loader2, RefreshCw } from 'lucide-react';
import { getUnifiedFeed, type Post } from '@/services/feed';
import { PostCard } from '@/components/features/PostCard';
import { FederatedPostCard } from '@/components/features/FederatedPostCard';

const PAGE_SIZE = 20;

export function UnifiedExploreFeed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await getUnifiedFeed({ mode: 'explore', limit: PAGE_SIZE });
      setPosts(result.posts);
    } catch (err) {
      console.error('[explore] unified feed failed:', err);
      setError('Unable to load the unified discovery feed.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="border-b border-border">
      <div className="flex items-center gap-2 px-4 py-3">
        <Globe className="w-4 h-4 text-primary" />
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-sm">Unified discovery</h2>
          <p className="text-[11px] text-muted-foreground">Public Testagram + Fediverse posts, ranked together</p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading || refreshing}
          aria-label="Refresh unified discovery"
          className="p-2 rounded-full hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : error ? (
        <div className="px-4 pb-5 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-2 text-sm font-semibold text-primary">Try again</button>
        </div>
      ) : posts.length === 0 ? (
        <p className="px-4 pb-6 text-sm text-muted-foreground">No public posts are available yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {posts.map(post => (
            post.origin === 'federated'
              ? <FederatedPostCard key={`fed:${post.id}`} post={post} />
              : <PostCard key={`local:${post.id}`} post={post as any} />
          ))}
        </div>
      )}
    </section>
  );
}
