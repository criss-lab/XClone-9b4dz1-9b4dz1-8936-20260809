import { useEffect, useMemo, useState } from 'react';
import { getUnifiedFeed } from '@/services/feed';
import { PostCard } from '@/components/features/PostCard';
import { FederatedPostCard } from '@/components/features/FederatedPostCard';
import { Loader2, MessageSquareText, Sparkles } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';

type Props = {
  activeTab: 'For You' | 'Following' | 'Trending' | 'Reading List';
  searchQuery?: string;
};

type MixedItem = {
  type: 'post' | 'thread' | 'fedpost';
  data: any;
};

function ThreadInlineCard({ thread }: { thread: any }) {
  const navigate = useNavigate();
  const author = thread.author ?? thread.user_profiles ?? {};
  const title = thread.title ?? 'Thread';
  const content = String(thread.content ?? thread.body ?? '').replace(/\s+/g, ' ').trim();
  return (
    <article className="border-b border-border p-4 hover:bg-muted/5 transition-colors">
      <div className="flex gap-3">
        <button onClick={() => author.id && navigate(`/profile/${author.id}`)} className="w-10 h-10 rounded-full bg-muted overflow-hidden flex-shrink-0" aria-label="Open thread author">
          {author.avatar_url ? <img src={author.avatar_url} alt="" className="w-full h-full object-cover" /> : <span className="w-full h-full flex items-center justify-center font-bold">{String(author.username ?? 'T')[0]?.toUpperCase()}</span>}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{author.username ?? 'Testagram creator'}</span>
            {author.verified && <span className="text-primary text-xs">✓</span>}
            <span className="text-xs text-muted-foreground">· {thread.created_at ? formatDistanceToNow(new Date(thread.created_at), { addSuffix: true }) : 'now'}</span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-primary bg-primary/10 rounded-full px-2 py-0.5">Thread</span>
          </div>
          <button onClick={() => navigate(`/thread/${thread.id}`)} className="text-left w-full mt-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30">
            <h3 className="font-bold text-base leading-snug">{title}</h3>
            <p className="text-sm leading-relaxed mt-1 line-clamp-6 whitespace-pre-wrap break-words">{content}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <span>{Number(thread.views_count ?? 0).toLocaleString()} views</span>
              <span>{Number(thread.likes_count ?? 0).toLocaleString()} likes</span>
              <span>{Number(thread.replies_count ?? 0).toLocaleString()} replies</span>
            </div>
          </button>
        </div>
      </div>
    </article>
  );
}

export function MixedThreadsSocialFeed({ activeTab, searchQuery = '' }: Props) {
  const [items, setItems] = useState<MixedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (activeTab === 'Reading List') return;
      setLoading(true);
      setError(null);
      try {
        const mode = activeTab === 'Following' ? 'following' : activeTab === 'Trending' ? 'explore' : 'home';
        const result = await getUnifiedFeed({ mode, limit: 30 });
        if (cancelled) return;
        const next: MixedItem[] = result.posts.map((item: any) => ({
          type: item.origin === 'federated' ? 'fedpost' : item.content_type === 'thread' || item.source === 'thread' ? 'thread' : 'post',
          data: item,
        }));
        setItems(next);
      } catch (err) {
        if (!cancelled) {
          console.error('[threads:mixed-feed]', err);
          setError('The unified social feed could not be loaded.');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [activeTab]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(item => {
      const d = item.data ?? {};
      const author = d.author ?? d.user_profiles ?? d.actor ?? {};
      return [d.title, d.content, d.body, author.username, author.preferredUsername, author.name]
        .filter(Boolean)
        .some((value: any) => String(value).toLowerCase().includes(q));
    });
  }, [items, searchQuery]);

  if (activeTab === 'Reading List') return null;
  return (
    <section className="border-b border-border bg-background" aria-label="Unified threads social feed">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-border/70 bg-muted/20">
        <Sparkles className="w-4 h-4 text-primary" />
        <div>
          <p className="text-sm font-bold">Threads + Posts + Fediverse</p>
          <p className="text-[11px] text-muted-foreground">One organic stream, ranked by the same unified graph.</p>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" />Building your mixed stream…</div>
      ) : error ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground"><MessageSquareText className="w-8 h-8 mx-auto mb-2 opacity-40" />No mixed content yet.</div>
      ) : (
        filtered.map((item, index) => (
          <div key={`${item.type}:${String(item.data?.id ?? item.data?.uri ?? index)}`}>
            {item.type === 'fedpost' ? <FederatedPostCard post={item.data} /> : item.type === 'post' ? <PostCard post={item.data} /> : <ThreadInlineCard thread={item.data} />}
          </div>
        ))
      )}
    </section>
  );
}
