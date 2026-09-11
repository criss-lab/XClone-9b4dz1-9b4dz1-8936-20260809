import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Heart, Loader2, MessageCircle, Quote, Repeat2, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PostCard } from '@/components/features/PostCard';
import { TopBar } from '@/components/layout/TopBar';

type EngagementKind = 'replies' | 'quotes' | 'reposts' | 'likes';

const config: Record<EngagementKind, { title: string; icon: typeof Heart }> = {
  replies: { title: 'Replies', icon: MessageCircle },
  quotes: { title: 'Quotes', icon: Quote },
  reposts: { title: 'Reposts', icon: Repeat2 },
  likes: { title: 'Likes', icon: Heart },
};

export default function PostEngagementPage() {
  const { postId, kind = 'replies' } = useParams<{ postId: string; kind: EngagementKind }>();
  const navigate = useNavigate();
  const selected = (kind in config ? kind : 'replies') as EngagementKind;
  const { title, icon: Icon } = config[selected];
  const [post, setPost] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!postId) return;
      setLoading(true);
      setError(null);
      try {
        const { data: source, error: sourceError } = await supabase.from('posts').select('*').eq('id', postId).maybeSingle();
        if (sourceError) throw sourceError;
        if (!source) { setPost(null); setItems([]); return; }
        let rows: any[] = [];
        if (selected === 'quotes') {
          const result = await supabase.from('posts').select('*').eq('quoted_post_id', postId).order('created_at', { ascending: false }).limit(50);
          if (result.error) throw result.error;
          rows = result.data ?? [];
        } else if (selected === 'replies') {
          const result = await supabase.from('replies').select('*, user_profiles (*)').eq('post_id', postId).order('created_at', { ascending: true }).limit(100);
          if (result.error) throw result.error;
          rows = result.data ?? [];
        } else if (selected === 'reposts') {
          const result = await supabase.from('reposts').select('*, user_profiles (*)').eq('post_id', postId).order('created_at', { ascending: false }).limit(100);
          if (result.error) throw result.error;
          rows = result.data ?? [];
        } else {
          const result = await supabase.from('likes').select('*, user_profiles (*)').eq('post_id', postId).order('created_at', { ascending: false }).limit(100);
          if (result.error) throw result.error;
          rows = result.data ?? [];
        }
        if (active) { setPost(source); setItems(rows); }
      } catch (err: any) {
        if (active) setError(err?.message ?? `Unable to load ${title.toLowerCase()}`);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [postId, selected, title]);

  if (loading) return <div className="min-h-[40vh] flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>;
  if (!post) return <div className="p-6 text-sm text-muted-foreground">Post unavailable.</div>;

  return <div className="min-h-screen bg-background pb-20">
    <TopBar title={title} showBack />
    <div className="border-b border-border p-3 flex gap-2 overflow-x-auto">
      {(Object.keys(config) as EngagementKind[]).map(tab => <button key={tab} onClick={() => navigate(`/post/${postId}/${tab}`)} className={`px-3 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${tab === selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{config[tab].title}</button>)}
    </div>
    <section className="border-b border-border p-3"><PostCard post={post} /></section>
    <section className="p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold"><Icon className="w-4 h-4" />{title}</div>
      {items.length === 0 ? <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">No {title.toLowerCase()} yet.</div> : selected === 'quotes' ? items.map(item => <PostCard key={item.id} post={item} />) : selected === 'replies' ? items.map(item => <div key={item.id} className="rounded-xl border p-4"><div className="font-semibold text-sm">@{item.user_profiles?.username ?? 'user'}</div><p className="mt-1 text-sm whitespace-pre-wrap">{item.content}</p></div>) : items.map(item => <div key={item.id} className="rounded-xl border p-4 flex items-center gap-3"><Users className="w-4 h-4 text-muted-foreground" /><span className="font-semibold">@{item.user_profiles?.username ?? item.username ?? 'user'}</span></div>)}
    </section>
  </div>;
}
