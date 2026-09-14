import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, Globe, MoreHorizontal, X, ThumbsUp, MessageCircle, Share2, ExternalLink, Play, Pause, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { formatNumber } from '@/lib/utils';

interface UserAdCardProps {
  ad: {
    id: string;
    title: string;
    description: string;
    image_url?: string | null;
    video_url?: string | null;
    target_url?: string | null;
    impressions?: number;
    clicks?: number;
    user_profiles?: {
      id: string;
      username: string;
      avatar_url?: string | null;
      verified?: boolean;
    } | null;
  };
}

// ── Ad Frequency Cap: max 3 impressions per ad per user per 24h ──────────────
function checkAdFreqCapCard(adId: string): boolean {
  try {
    const key = `ts-adfreq-${adId}`;
    const raw = localStorage.getItem(key);
    const stamps: number[] = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return stamps.filter(t => t > cutoff).length >= 3;
  } catch { return false; }
}
function recordAdImpressionCard(adId: string): void {
  try {
    const key = `ts-adfreq-${adId}`;
    const raw = localStorage.getItem(key);
    const stamps: number[] = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = stamps.filter(t => t > cutoff);
    recent.push(Date.now());
    localStorage.setItem(key, JSON.stringify(recent));
  } catch {}
}

/**
 * UserAdCard — Facebook-style sponsored post card.
 * Features: advertiser header with "Ad · 🌐" label, full-bleed media,
 * body copy with expand, link preview strip, full-width CTA button,
 * and a like/comment/share engagement row.
 */
export function UserAdCard({ ad }: UserAdCardProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const impressionTracked = useRef(false);
  const [dismissed, setDismissed] = useState(() => checkAdFreqCapCard(ad.id));
  const [expanded, setExpanded] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(ad.impressions ? Math.floor(ad.impressions * 0.04) : 0);
  const [shareCount, setShareCount] = useState(ad.clicks ? Math.floor(ad.clicks * 0.05) : 0);
  const [showStoryFormat, setShowStoryFormat] = useState(false);
  const videoProbeRef = useRef<HTMLVideoElement | null>(null);
  const [isVerticalVideo, setIsVerticalVideo] = useState(false);
  const storyProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [storyProgress, setStoryProgress] = useState(0);
  const [storyPaused, setStoryPaused] = useState(false);
  const storyPausedRef = useRef(false);

  useEffect(() => {
    if (impressionTracked.current) return;
    impressionTracked.current = true;
    recordAdImpressionCard(ad.id);
    supabase.from('ad_impressions').insert({
      ad_id: ad.id,
      user_id: user?.id ?? null,
      clicked: false,
    }).then(() => {}, () => {});
  }, [ad.id, user?.id]);

  // Detect vertical video (9:16 aspect ratio) for Story format
  useEffect(() => {
    if (!ad.video_url) return;
    const v = document.createElement('video');
    v.src = ad.video_url;
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      const ratio = v.videoHeight / v.videoWidth;
      setIsVerticalVideo(ratio >= 1.4); // roughly 9:16 or taller
      v.src = '';
    };
    videoProbeRef.current = v;
    return () => { v.src = ''; };
  }, [ad.video_url]);

  // Story format: 15-second auto-advance with progress bar
  const startStoryProgress = useCallback(() => {
    setStoryProgress(0);
    storyPausedRef.current = false;
    if (storyProgressRef.current) clearInterval(storyProgressRef.current);
    const DURATION_MS = 15000;
    const TICK_MS = 100;
    let elapsed = 0;
    storyProgressRef.current = setInterval(() => {
      if (storyPausedRef.current) return;
      elapsed += TICK_MS;
      const pct = Math.min((elapsed / DURATION_MS) * 100, 100);
      setStoryProgress(pct);
      if (pct >= 100) {
        clearInterval(storyProgressRef.current!);
        setShowStoryFormat(false);
      }
    }, TICK_MS);
  }, []);

  const stopStoryProgress = useCallback(() => {
    if (storyProgressRef.current) clearInterval(storyProgressRef.current);
    setShowStoryFormat(false);
    setStoryProgress(0);
  }, []);

  const toggleStoryPause = useCallback(() => {
    storyPausedRef.current = !storyPausedRef.current;
    setStoryPaused(storyPausedRef.current);
  }, []);

  const openStoryFormat = useCallback(() => {
    setShowStoryFormat(true);
    startStoryProgress();
    supabase.from('ad_impressions').insert({ ad_id: ad.id, user_id: user?.id ?? null, clicked: true }).then(() => {}, () => {});
  }, [ad.id, user?.id, startStoryProgress]);

  useEffect(() => {
    return () => { if (storyProgressRef.current) clearInterval(storyProgressRef.current); };
  }, []);

  const handleClick = () => {
    supabase.from('ad_impressions').insert({
      ad_id: ad.id,
      user_id: user?.id ?? null,
      clicked: true,
    }).then(() => {}, () => {});
    supabase.rpc('track_ad_view', { ad_id_param: ad.id, user_id_param: user?.id ?? null }).then(() => {}, () => {});
    if (ad.target_url) window.open(ad.target_url, '_blank', 'noopener,noreferrer');
  };

  const handleLike = () => {
    const next = !liked;
    setLiked(next);
    if (next) {
      // Track like as an engagement impression
      supabase.from('ad_impressions').insert({ ad_id: ad.id, user_id: user?.id ?? null, clicked: true }).then(() => {}, () => {});
    }
  };

  const handleShare = () => {
    setShareCount(c => c + 1);
    supabase.from('ad_impressions').insert({ ad_id: ad.id, user_id: user?.id ?? null, clicked: true }).then(() => {}, () => {});
    if (ad.target_url) {
      navigator.clipboard.writeText(ad.target_url).then(() => {}, () => {});
    }
  };

  if (dismissed) return null;

  // Derived display values — declared before any early return so Story Format can use them
  const advertiserName = ad.user_profiles?.username ?? 'Advertiser';
  const advertiserAvatar = ad.user_profiles?.avatar_url;
  const isVerified = ad.user_profiles?.verified;

  let domain = '';
  let domainShort = '';
  if (ad.target_url) {
    try {
      const u = new URL(ad.target_url);
      domain = u.hostname;
      domainShort = domain.replace(/^www\./, '');
    } catch { domain = ''; }
  }

  const bodyText = ad.description ?? '';
  const SHORT_LIMIT = 120;
  const isLong = bodyText.length > SHORT_LIMIT;
  const displayBody = expanded || !isLong ? bodyText : bodyText.slice(0, SHORT_LIMIT) + '\u2026';

  const commentCount = ad.clicks ? Math.floor(ad.clicks * 0.12) : 0;

  // ── Story Format (vertical video 9:16) ──────────────────────────────────
  if (isVerticalVideo && showStoryFormat && ad.video_url) {
    return (
      <div
        className="fixed inset-0 z-[500] bg-black flex items-center justify-center"
        onClick={toggleStoryPause}
      >
        {/* Progress bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-white/20 z-10">
          <div
            className="h-full bg-white transition-none rounded-full"
            style={{ width: storyProgress + '%' }}
          />
        </div>
        {/* Header */}
        <div className="absolute top-4 left-0 right-0 flex items-center gap-3 px-4 z-10">
          <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-white shrink-0">
            {advertiserAvatar
              ? <img src={advertiserAvatar} alt={advertiserName} className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-primary flex items-center justify-center font-bold text-white text-sm">{advertiserName[0]?.toUpperCase()}</div>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight truncate">{advertiserName}</p>
            <p className="text-white/60 text-[11px] flex items-center gap-1"><Globe className="w-2.5 h-2.5" />Ad</p>
          </div>
          <button onClick={e => { e.stopPropagation(); stopStoryProgress(); }} className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        {/* Video */}
        <video
          src={ad.video_url}
          className="h-full w-full object-cover"
          autoPlay
          muted
          playsInline
          loop
          style={{ maxHeight: '100dvh' }}
        />
        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 pointer-events-none" />
        {/* Pause indicator */}
        {storyPaused && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
              <Pause className="w-8 h-8 text-white" />
            </div>
          </div>
        )}
        {/* Footer CTA */}
        <div className="absolute bottom-8 left-4 right-4 z-10" onClick={e => e.stopPropagation()}>
          <p className="text-white font-bold text-lg leading-tight mb-1">{ad.title}</p>
          <p className="text-white/80 text-sm mb-4 line-clamp-2">{ad.description}</p>
          {ad.target_url && (
            <button
              onClick={handleClick}
              className="w-full py-3.5 bg-white text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all"
            >
              {domainShort || 'Learn more'}
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-border bg-card hover:bg-muted/5 transition-colors">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-2">
        <div
          className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 cursor-pointer border border-border"
          onClick={() => ad.user_profiles && navigate(`/profile/${advertiserName}`)}
        >
          {advertiserAvatar ? (
            <img src={advertiserAvatar} alt={advertiserName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/30 to-amber-400/20 flex items-center justify-center font-bold text-primary text-sm">
              {advertiserName[0]?.toUpperCase()}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <button
              className="font-bold text-sm hover:underline truncate"
              onClick={() => ad.user_profiles && navigate(`/profile/${advertiserName}`)}
            >
              {advertiserName}
            </button>
            {isVerified && <BadgeCheck className="w-4 h-4 text-primary shrink-0" fill="currentColor" />}
          </div>
          {/* "Ad · 🌐" label — exact Facebook pattern */}
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-xs text-muted-foreground font-medium">Ad</span>
            <span className="text-muted-foreground/40 text-xs">·</span>
            <Globe className="w-3 h-3 text-muted-foreground" />
          </div>
        </div>

        {/* Options + close */}
        <div className="flex items-center gap-1 shrink-0">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground transition-colors">
            <MoreHorizontal className="w-5 h-5" />
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Body copy ──────────────────────────────────────────────── */}
      <div className="px-4 pb-2.5">
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
          {displayBody}
          {isLong && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="text-primary font-semibold ml-1 hover:underline"
            >
              See more
            </button>
          )}
        </p>
      </div>

      {/* ── Full-bleed media ────────────────────────────────────────── */}
      {ad.video_url ? (
        <div className="w-full bg-black cursor-pointer" onClick={handleClick}>
          <video
            src={ad.video_url}
            className="w-full max-h-[400px] object-cover"
            muted
            autoPlay
            loop
            playsInline
          />
        </div>
      ) : ad.image_url ? (
        <div className="w-full cursor-pointer relative" onClick={handleClick}>
          <img
            src={ad.image_url}
            alt={ad.title}
            className="w-full max-h-[400px] object-cover"
            loading="lazy"
          />
        </div>
      ) : null}

      {/* Story format trigger — shown when vertical video detected */}
      {isVerticalVideo && ad.video_url && !showStoryFormat && (
        <div
          className="relative cursor-pointer overflow-hidden bg-black"
          onClick={openStoryFormat}
        >
          <video
            src={`${ad.video_url}#t=0.5`}
            className="w-full max-h-[300px] object-cover opacity-80"
            muted
            preload="metadata"
            playsInline
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30">
              <Play className="w-7 h-7 text-white fill-white ml-1" />
            </div>
          </div>
          <div className="absolute bottom-3 left-3 right-3">
            <p className="text-white text-sm font-bold line-clamp-1">{ad.title}</p>
            <p className="text-white/60 text-[11px] mt-0.5">Tap to watch full story ad</p>
          </div>
        </div>
      )}

      {/* ── Link preview strip (Facebook-style) ─────────────────────── */}
      {domain && (
        <div
          className="flex items-center justify-between bg-muted/40 border-t border-border px-4 py-3 cursor-pointer hover:bg-muted/60 transition-colors"
          onClick={handleClick}
        >
          <div className="min-w-0 flex-1 mr-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium truncate">{domainShort}</p>
            <p className="font-bold text-sm leading-tight line-clamp-1 mt-0.5">{ad.title}</p>
            {ad.description && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{ad.description}</p>
            )}
          </div>
          {/* CTA button */}
          <button
            className="shrink-0 px-4 py-2 bg-muted border border-border rounded-md text-sm font-bold hover:bg-muted/80 transition-colors whitespace-nowrap"
            onClick={handleClick}
          >
            {ad.target_url?.includes('sign') || ad.target_url?.includes('register')
              ? 'Sign up'
              : ad.target_url?.includes('shop') || ad.target_url?.includes('buy')
              ? 'Shop now'
              : 'Learn more'}
          </button>
        </div>
      )}

      {/* ── Engagement counts ───────────────────────────────────────── */}
      {(likeCount > 0 || commentCount > 0) && (
        <div className="px-4 py-1.5 flex items-center justify-between text-xs text-muted-foreground border-t border-border/50">
          <div className="flex items-center gap-1.5">
            {likeCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-[8px] text-white">👍</span>
                {formatNumber(likeCount + (liked ? 1 : 0))}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {commentCount > 0 && <span>{formatNumber(commentCount)} comments</span>}
            {shareCount > 0 && <span>{formatNumber(shareCount)} shares</span>}
          </div>
        </div>
      )}

      {/* ── Action bar ─────────────────────────────────────────────── */}
      <div className="px-2 py-0.5 flex items-center border-t border-border/60">
        <button
          onClick={handleLike}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors hover:bg-muted/60 ${liked ? 'text-blue-600' : 'text-muted-foreground'}`}
        >
          <ThumbsUp className={`w-4 h-4 ${liked ? 'fill-blue-600' : ''}`} />
          Like
        </button>
        <button
          onClick={() => {
            supabase.from('ad_impressions').insert({ ad_id: ad.id, user_id: user?.id ?? null, clicked: true }).then(() => {}, () => {});
          }}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          <MessageCircle className="w-4 h-4" />
          Comment
        </button>
        <button
          onClick={handleShare}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          <Share2 className="w-4 h-4" />
          Share {shareCount > 0 && <span className="text-xs opacity-60">{shareCount}</span>}
        </button>
      </div>

      {/* ── Why am I seeing this ────────────────────────────────────── */}
      <div className="px-4 pb-2 flex items-center gap-2 text-[10px] text-muted-foreground/50">
        <span>Why this ad?</span>
        <span>·</span>
        <button className="hover:text-primary transition-colors" onClick={() => navigate('/create-ad')}>
          <ExternalLink className="w-3 h-3 inline mr-0.5" />
          Advertise
        </button>
      </div>
    </div>
  );
}
