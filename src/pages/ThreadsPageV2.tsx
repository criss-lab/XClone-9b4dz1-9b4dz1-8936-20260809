import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, Bookmark, Clock3, Eye, Heart, Image as ImageIcon, Loader2, MessageCircle, PenLine, Play, Repeat2, Search, Share2, Sparkles, TrendingUp, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { formatDistanceToNow } from 'date-fns';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';
import { useSEO } from '@/hooks/useSEO';

interface Thread { id: string; user_id: string; title: string; content: string; cover_image: string | null; media_url: string | null; media_type: string | null; views_count: number; likes_count: number; reposts_count: number; replies_count: number; created_at: string; user_profiles?: { username: string; avatar_url: string | null; verified: boolean }; }
const TABS = ['For You', 'Following', 'Trending', 'Saved'] as const;
type Tab = typeof TABS[number];

const clean = (s: string) => s.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
const readMinutes = (s: string) => Math.max(1, Math.ceil(s.trim().split(/\s+/).filter(Boolean).length / 210));

export default function ThreadsPageV2() {
  const { user } = useAuth(); const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('For You'); const [threads, setThreads] = useState<Thread[]>([]); const [loading, setLoading] = useState(true); const [q, setQ] = useState(''); const [searchOpen, setSearchOpen] = useState(false); const [liked, setLiked] = useState<string[]>([]); const [saved, setSaved] = useState<string[]>([]);
  useSEO({ title: 'Threads — Stories & Conversations', description: 'Discover long-form stories, thoughtful conversations, analysis and creator threads on Testagram.', url: '/threads', type: 'website', keywords: 'threads, stories, articles, conversations, creators, Testagram' });

  const load = async () => {
    setLoading(true);
    try {
      if (tab === 'Saved') {
        if (!user) { setThreads([]); return; }
        const { data: b, error: be } = await supabase.from('thread_bookmarks').select('thread_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
        if (be) throw be; const ids = (b ?? []).map((x: any) => x.thread_id); if (!ids.length) { setThreads([]); return; }
        const { data, error } = await supabase.from('threads').select('id,user_id,title,content,cover_image,media_url,media_type,views_count,likes_count,reposts_count,replies_count,created_at,user_profiles(username,avatar_url,verified)').in('id', ids).eq('is_published', true); if (error) throw error; setThreads((data ?? []) as unknown as Thread[]); return;
      }
      let query = supabase.from('threads').select('id,user_id,title,content,cover_image,media_url,media_type,views_count,likes_count,reposts_count,replies_count,created_at,user_profiles(username,avatar_url,verified)').eq('is_published', true);
      if (tab === 'Following') {
        if (!user) { setThreads([]); return; }
        const { data: f } = await supabase.from('follows').select('following_id').eq('follower_id', user.id); const ids = (f ?? []).map(x => x.following_id); if (!ids.length) { setThreads([]); return; } query = query.in('user_id', ids);
      }
      query = query.order(tab === 'Trending' ? 'views_count' : 'created_at', { ascending: false }).limit(80);
      const { data, error } = await query; if (error) throw error; setThreads((data ?? []) as unknown as Thread[]);
    } catch (e) { console.error(e); toast.error('Could not load threads'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [tab, user?.id]);
  useEffect(() => { if (!user) { setLiked([]); setSaved([]); return; } Promise.all([supabase.from('thread_likes').select('thread_id').eq('user_id', user.id).limit(500), supabase.from('thread_bookmarks').select('thread_id').eq('user_id', user.id).limit(500)]).then(([a,b]) => { setLiked((a.data ?? []).map((x:any)=>x.thread_id)); setSaved((b.data ?? []).map((x:any)=>x.thread_id)); }); }, [user?.id]);

  const filtered = useMemo(() => { const needle = q.trim().toLowerCase(); if (!needle) return threads; return threads.filter(t => `${t.title} ${t.content} ${t.user_profiles?.username ?? ''}`.toLowerCase().includes(needle)); }, [threads,q]);
  const toggleLike = async (e: React.MouseEvent, t: Thread) => { e.stopPropagation(); if (!user) { navigate('/auth'); return; } const on = liked.includes(t.id); setLiked(p => on ? p.filter(x=>x!==t.id) : [...p,t.id]); setThreads(p=>p.map(x=>x.id===t.id?{...x,likes_count:Math.max(0,x.likes_count+(on?-1:1))}:x)); const result = on ? await supabase.from('thread_likes').delete().eq('thread_id',t.id).eq('user_id',user.id) : await supabase.from('thread_likes').insert({thread_id:t.id,user_id:user.id}); if(result.error) toast.error('Like failed'); };
  const toggleSave = async (e: React.MouseEvent, t: Thread) => { e.stopPropagation(); if (!user) { navigate('/auth'); return; } const on=saved.includes(t.id); setSaved(p=>on?p.filter(x=>x!==t.id):[...p,t.id]); if(on) await supabase.from('thread_bookmarks').delete().eq('thread_id',t.id).eq('user_id',user.id); else await supabase.from('thread_bookmarks').insert({thread_id:t.id,user_id:user.id}); toast.success(on?'Removed from saved':'Saved to reading list'); };
  const share = async (e: React.MouseEvent, t: Thread) => { e.stopPropagation(); const url=`${window.location.origin}/thread/${t.id}`; try { await navigator.share({title:t.title,text:clean(t.content).slice(0,100),url}); } catch { await navigator.clipboard.writeText(url); toast.success('Thread link copied'); } };

  return <div className="min-h-screen bg-background pb-20">
    <div className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-xl">
      <div className="flex items-center justify-between px-4 pt-3"><div><h1 className="text-xl font-black tracking-tight">Threads</h1><p className="text-xs text-muted-foreground">Long-form ideas worth your time</p></div><div className="flex items-center gap-1"><button onClick={()=>setSearchOpen(v=>!v)} className="p-2.5 rounded-full hover:bg-muted" aria-label="Search"><Search className="w-5 h-5"/></button><button onClick={()=>navigate('/threads/create')} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-primary text-primary-foreground text-xs font-bold"><PenLine className="w-3.5 h-3.5"/>Write</button></div></div>
      {searchOpen && <div className="px-4 py-2.5"><div className="flex items-center gap-2 bg-muted/60 rounded-xl px-3 py-2"><Search className="w-4 h-4 text-muted-foreground"/><input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search stories, ideas, creators…" className="flex-1 bg-transparent outline-none text-sm"/><button onClick={()=>{setQ('');setSearchOpen(false)}}><X className="w-4 h-4"/></button></div></div>}
      <div className="flex overflow-x-auto scrollbar-hide px-2 pt-1">{TABS.map(t=><button key={t} onClick={()=>setTab(t)} className={`shrink-0 px-4 py-3 text-sm font-bold border-b-2 ${tab===t?'border-primary text-foreground':'border-transparent text-muted-foreground'}`}>{t==='Trending'?<span className="flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5"/>Trending</span>:t}</button>)}</div>
    </div>
    <div className="mx-auto max-w-2xl">
      {loading ? <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary"/></div> : filtered.length===0 ? <div className="py-20 text-center px-6"><Sparkles className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40"/><h2 className="font-bold text-lg">{tab==='Following'?'Follow creators to build your reading feed':'Nothing here yet'}</h2><p className="text-sm text-muted-foreground mt-1">{tab==='Saved'?'Bookmark a thread and it will appear in your reading list.':'Explore Testagram and discover your next great conversation.'}</p></div> : <div className="divide-y divide-border">{filtered.map(t=>{const text=clean(t.content); const video=!!t.media_url&&t.media_type==='video'; const image=!!t.cover_image; return <article key={t.id} onClick={()=>navigate(`/thread/${t.id}`)} className="p-4 sm:p-5 cursor-pointer hover:bg-muted/25 transition-colors">
        <div className="flex items-center gap-2.5 mb-3"><div className="w-9 h-9 rounded-full bg-muted overflow-hidden shrink-0">{t.user_profiles?.avatar_url?<img src={t.user_profiles.avatar_url} alt="" className="w-full h-full object-cover"/>:<div className="h-full flex items-center justify-center font-bold text-sm">{t.user_profiles?.username?.[0]?.toUpperCase()??'?'}</div>}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1"><span className="font-bold text-sm truncate">@{t.user_profiles?.username??'creator'}</span>{t.user_profiles?.verified&&<BadgeCheck className="w-3.5 h-3.5 text-primary" fill="currentColor"/>}</div><span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(t.created_at),{addSuffix:true})}</span></div><span className="text-[11px] text-muted-foreground flex items-center gap-1"><Clock3 className="w-3 h-3"/>{readMinutes(t.content)} min</span></div>
        <h2 className="text-xl sm:text-2xl font-black leading-tight tracking-tight mb-2">{t.title}</h2><p className="text-sm text-muted-foreground leading-6 line-clamp-3">{text}</p>
        {video&&<div className="mt-4 relative rounded-2xl overflow-hidden bg-black aspect-video"><video src={t.media_url!} poster={t.cover_image??undefined} muted playsInline preload="metadata" className="w-full h-full object-cover"/><div className="absolute inset-0 flex items-center justify-center"><span className="w-12 h-12 rounded-full bg-black/55 flex items-center justify-center"><Play className="w-5 h-5 text-white ml-1" fill="white"/></span></div></div>}
        {!video&&image&&<img src={t.cover_image!} alt="" loading="lazy" className="mt-4 w-full max-h-80 object-cover rounded-2xl"/>}
        <div className="mt-4 flex items-center gap-4 text-muted-foreground"><button onClick={e=>toggleLike(e,t)} className={`flex items-center gap-1.5 text-xs font-semibold ${liked.includes(t.id)?'text-pink-600':''}`}><Heart className={`w-4 h-4 ${liked.includes(t.id)?'fill-current':''}`}/>{formatNumber(t.likes_count)}</button><span className="flex items-center gap-1.5 text-xs"><MessageCircle className="w-4 h-4"/>{formatNumber(t.replies_count)}</span><span className="flex items-center gap-1.5 text-xs"><Eye className="w-4 h-4"/>{formatNumber(t.views_count)}</span><span className="flex items-center gap-1.5 text-xs"><Repeat2 className="w-4 h-4"/>{formatNumber(t.reposts_count)}</span><button onClick={e=>toggleSave(e,t)} className={`ml-auto ${saved.includes(t.id)?'text-primary':''}`}><Bookmark className={`w-4 h-4 ${saved.includes(t.id)?'fill-current':''}`}/></button><button onClick={e=>share(e,t)}><Share2 className="w-4 h-4"/></button></div>
      </article>})}</div>}
    </div>
  </div>;
}
