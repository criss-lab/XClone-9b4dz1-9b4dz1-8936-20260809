import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Play, Eye, Flame, TrendingUp, ChevronRight, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatNumber } from '@/lib/utils';

interface VideoPost {
  id: string;
  video_url: string | null;
  image_url: string | null;
  views_count: number;
  likes_count: number;
  content: string;
  user_profiles: { username: string; avatar_url: string | null } | null;
}

interface FediversePost {
  id: string;
  url?: string;
  content?: string;
  created_at?: string;
  platform_rank_score?: number;
  fediverse_domain?: string;
  actor?: {
    username?: string;
    acct?: string;
    display_name?: string;
    avatar?: string;
    icon?: { url?: string };
    avatar_url?: string;
  };
  account?: {
    username?: string;
    acct?: string;
    display_name?: string;
    avatar?: string;
    icon?: { url?: string };
    avatar_url?: string;
  };
  media_attachments?: { type?: string; url?: string; preview_url?: string; description?: string }[];
}

interface Props { variant?: 'compact' | 'full'; }

const normalizeVideoPosts = (rows: any[]): VideoPost[] => rows.map((row) => ({
  ...row,
  user_profiles: Array.isArray(row.user_profiles) ? (row.user_profiles[0] ?? null) : row.user_profiles,
}));

async function loadRankedFediverse(): Promise<FediversePost[]> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const response = await fetch('/api/fediverse-feed?limit=12', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload?.posts) ? payload.posts : [];
  } catch {
    return [];
  }
}

export function TrendingVideosSection({ variant = 'compact' }: Props) {
  const [videos, setVideos] = useState<VideoPost[]>([]);
  const [fediverse, setFediverse] = useState<FediversePost[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [recentResult, fedResult] = await Promise.allSettled([
        supabase.from('posts').select('id, video_url, image_url, views_count, likes_count, content, user_profiles(username, avatar_url)').eq('is_video', true).gte('created_at', since).order('views_count', { ascending: false }).limit(10),
        loadRankedFediverse(),
      ]);

      if (cancelled) return;

      let localVideos: any[] = [];
      if (recentResult.status === 'fulfilled') {
        localVideos = recentResult.value.data ?? [];
        if (localVideos.length < 3) {
          const { data: allTime } = await supabase.from('posts').select('id, video_url, image_url, views_count, likes_count, content, user_profiles(username, avatar_url)').eq('is_video', true).order('views_count', { ascending: false }).limit(10);
          localVideos = allTime ?? localVideos;
        }
      }
      setVideos(normalizeVideoPosts(localVideos));
      setFediverse(fedResult.status === 'fulfilled' ? fedResult.value.slice(0, 8) : []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="border-b border-border py-4 px-4"><div className="flex items-center gap-2 mb-3"><Flame className="w-4 h-4 text-orange-500" /><span className="font-bold text-sm">Trending Videos</span></div><div className="flex gap-2.5">{[0,1,2,3,4].map(i => <div key={i} className="shrink-0 w-28 h-40 rounded-xl bg-muted animate-pulse" />)}</div></div>;

  if (variant === 'compact') return (
    <>
      {videos.length > 0 && <div className="border-b border-border bg-gradient-to-r from-orange-500/5 via-background to-red-500/5 py-3"><div className="flex items-center gap-2 px-4 mb-2.5"><Flame className="w-4 h-4 text-orange-500 shrink-0" /><h3 className="font-bold text-sm">Trending Videos</h3><span className="text-[10px] font-bold text-orange-500/70 bg-orange-500/10 px-1.5 py-0.5 rounded-full">24h</span><button onClick={() => navigate('/videos')} className="ml-auto text-xs text-primary font-semibold hover:underline flex items-center gap-0.5">See all <ChevronRight className="w-3 h-3" /></button></div><div className="flex gap-2.5 overflow-x-auto scrollbar-hide px-4 pb-1">{videos.map((v, i) => <VideoThumb key={v.id} video={v} rank={i} onClick={() => navigate(`/videos?id=${v.id}`)} />)}</div></div>}
      {fediverse.length > 0 && <FediverseDiscoveryRail posts={fediverse} />}
    </>
  );

  const [featured, ...rest] = videos;
  const gridVideos = rest.slice(0, 8);
  return <>
    {videos.length > 0 && <div className="py-4 px-4 space-y-3"><div className="flex items-center gap-2"><div className="w-7 h-7 rounded-lg bg-orange-500/15 flex items-center justify-center shrink-0"><TrendingUp className="w-4 h-4 text-orange-500" /></div><h2 className="font-bold text-base">Trending Videos</h2><span className="text-[10px] font-black text-orange-500/80 bg-orange-500/10 px-2 py-0.5 rounded-full border border-orange-500/20">TOP 24H</span><button onClick={() => navigate('/videos')} className="ml-auto text-xs text-primary font-semibold hover:underline flex items-center gap-0.5">Open Reels <ChevronRight className="w-3.5 h-3.5" /></button></div><div className="grid grid-cols-5 gap-2" style={{ height: 220 }}>{featured && <button onClick={() => navigate(`/videos?id=${featured.id}`)} className="col-span-2 relative rounded-2xl overflow-hidden bg-zinc-900 h-full"><ThumbnailMedia video={featured} /><div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent" /><div className="absolute inset-0 flex items-center justify-center"><div className="w-11 h-11 bg-white/25 backdrop-blur-sm rounded-full flex items-center justify-center"><Play className="w-5 h-5 text-white fill-white ml-0.5" /></div></div><div className="absolute bottom-3 left-2 right-2"><p className="text-white text-[10px] font-bold truncate mb-0.5 leading-tight line-clamp-2">{featured.content?.slice(0, 55) || 'Trending video'}</p><div className="flex items-center gap-1 text-white/80 text-[9px] font-semibold"><Eye className="w-2.5 h-2.5" /><span>{formatNumber(featured.views_count || 0)} views</span></div></div></button>}<div className="col-span-3 grid grid-cols-2 gap-2 h-full">{gridVideos.slice(0, 4).map((v, i) => <button key={v.id} onClick={() => navigate(`/videos?id=${v.id}`)} className="relative rounded-xl overflow-hidden bg-zinc-900"><ThumbnailMedia video={v} /><div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" /><div className="absolute inset-0 flex items-center justify-center"><div className="w-7 h-7 bg-white/20 rounded-full flex items-center justify-center"><Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" /></div></div><div className="absolute bottom-1.5 left-1.5 right-1.5"><div className="flex items-center gap-0.5 text-white text-[8px] font-bold"><Eye className="w-2 h-2" />{formatNumber(v.views_count || 0)}</div></div></button>)}</div></div>{gridVideos.length > 4 && <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4">{gridVideos.slice(4).map((v, i) => <VideoThumb key={v.id} video={v} rank={i + 5} onClick={() => navigate(`/videos?id=${v.id}`)} />)}</div>}</div>}
    {fediverse.length > 0 && <FediverseDiscoveryRail posts={fediverse} />}
  </>;
}

function FediverseDiscoveryRail({ posts }: { posts: FediversePost[] }) {
  return (
    <section className="border-b border-border bg-muted/[0.06] py-3" aria-label="Federated discovery">
      <div className="flex items-center gap-1.5 px-4 mb-2.5">
        <Globe className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">Discover</span>
        <span className="text-[9px] font-medium text-muted-foreground/45 tracking-wide">fediv</span>
        <span className="text-[9px] text-muted-foreground/50">· ranked for you</span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto scrollbar-hide px-4 pb-1">
        {posts.map((post) => {
          const actor = post.actor ?? post.account ?? {};
          const username = actor.username ?? actor.acct ?? 'unknown';
          const displayName = actor.display_name ?? username;
          const avatar = actor.avatar ?? actor.avatar_url ?? actor.icon?.url;
          const media = post.media_attachments?.[0];
          const text = (post.content ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          return (
            <a
              key={post.url ?? post.id}
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 w-[250px] rounded-xl border border-border bg-card/80 p-3 hover:border-primary/30 hover:bg-card transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                  {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">{username[0]?.toUpperCase()}</div>}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold truncate">{displayName}</p>
                  <p className="text-[9px] text-muted-foreground truncate">@{username}@{post.fediverse_domain ?? 'fediverse'}</p>
                </div>
                <span className="ml-auto shrink-0 text-[8px] font-medium text-muted-foreground/40">fediv</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-foreground/85 line-clamp-3">{text || 'Federated post'}</p>
              {media?.url && <img src={media.preview_url ?? media.url} alt={media.description ?? ''} className="mt-2 h-24 w-full rounded-lg object-cover" loading="lazy" />}
              <div className="mt-2 flex items-center gap-3 text-[9px] text-muted-foreground/65">
                <span>Ranked for you</span>
                <span>·</span>
                <span>Open on origin</span>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function VideoThumb({ video, rank, onClick }: { video: VideoPost; rank: number; onClick: () => void }) { return <button onClick={onClick} className="shrink-0 relative w-[108px] h-[160px] rounded-xl overflow-hidden bg-zinc-900 shadow-lg"><ThumbnailMedia video={video} /><div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" /><div className="absolute inset-0 flex items-center justify-center"><div className="w-9 h-9 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center"><Play className="w-4 h-4 text-white fill-white ml-0.5" /></div></div><div className="absolute bottom-2 left-1.5 right-1.5"><div className="flex items-center gap-0.5 text-white text-[9px] font-bold mb-0.5"><Eye className="w-2.5 h-2.5 shrink-0" />{formatNumber(video.views_count || 0)}</div><p className="text-white/70 text-[8px] truncate">@{video.user_profiles?.username}</p></div></button>; }

function ThumbnailMedia({ video }: { video: VideoPost }) { if (video.image_url) return <img src={video.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />; if (video.video_url) return <video src={`${video.video_url}#t=0.5`} className="w-full h-full object-cover" muted preload="metadata" playsInline />; return <div className="w-full h-full bg-gradient-to-br from-orange-900 to-red-900 flex items-center justify-center"><Play className="w-8 h-8 text-white/30 fill-white/30" /></div>; }
