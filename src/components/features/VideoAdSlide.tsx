/**
 * VideoAdSlide — Full-screen TikTok/Reels-style sponsored ad slide.
 * Injected every Nth slot in the video feed.
 * Matches Facebook Reels ad pattern: advertiser avatar + "Ad · 🌐" label,
 * full-screen creative, body copy with "more", link preview CTA, Like/Comment/Share bar, Ad badge.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, Globe, MoreHorizontal, X, ThumbsUp, MessageCircle, Share2, ExternalLink, Volume2, VolumeX, Megaphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';

interface VideoAdSlideProps {
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
  isActive: boolean;
}

// ── Ad Frequency Cap: max 3 impressions per ad per user per 24h ──────────────
// Uses localStorage key ts-adfreq-{adId} → JSON array of timestamps
function checkAdFreqCap(adId: string): boolean {
  try {
    const key = `ts-adfreq-${adId}`;
    const raw = localStorage.getItem(key);
    const stamps: number[] = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = stamps.filter(t => t > cutoff);
    return recent.length >= 3;
  } catch { return false; }
}
function recordAdImpression(adId: string): void {
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

export function VideoAdSlide({ ad, isActive }: VideoAdSlideProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const impressionTracked = useRef(false);
  const completionTracked = useRef(false);
  const skipTracked = useRef(false);
  const watchStartRef = useRef<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Check frequency cap before rendering — cap exceeded means hidden immediately
  const [dismissed, setDismissed] = useState(() => checkAdFreqCap(ad.id));
  const [expanded, setExpanded] = useState(false);
  const [liked, setLiked] = useState(false);
  const [muted, setMuted] = useState(true);
  const [likeCount, setLikeCount] = useState(ad.impressions ? Math.floor(ad.impressions * 0.04) : Math.floor(Math.random() * 800 + 100));
  const [commentCount] = useState(ad.clicks ? Math.floor(ad.clicks * 0.12) : Math.floor(Math.random() * 50 + 5));
  const [shareCount] = useState(ad.clicks ? Math.floor(ad.clicks * 0.05) : Math.floor(Math.random() * 20 + 1));
  // Skip button: counts down from 5 then shows "Skip Ad"
  const [skipCountdown, setSkipCountdown] = useState(5);
  const [canSkip, setCanSkip] = useState(false);
  const skipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track impression once when slide becomes active + start skip countdown
  useEffect(() => {
    if (!isActive) {
      // Pause/clear skip timer when slide is not active
      if (skipTimerRef.current) clearInterval(skipTimerRef.current);
      return;
    }
    if (!impressionTracked.current) {
      impressionTracked.current = true;
      watchStartRef.current = Date.now();
      recordAdImpression(ad.id);
      supabase.from('ad_impressions').insert({
        ad_id: ad.id,
        user_id: user?.id ?? null,
        clicked: false,
        skipped: false,
        completed: false,
      }).then(() => {}, () => {});
    }
    // Start skip countdown
    setSkipCountdown(5);
    setCanSkip(false);
    if (skipTimerRef.current) clearInterval(skipTimerRef.current);
    let count = 5;
    skipTimerRef.current = setInterval(() => {
      count -= 1;
      setSkipCountdown(count);
      if (count <= 0) {
        clearInterval(skipTimerRef.current!);
        setCanSkip(true);
      }
    }, 1000);
    return () => { if (skipTimerRef.current) clearInterval(skipTimerRef.current); };
  }, [isActive, ad.id, user?.id]);

  // Play/pause video with tab activity
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !ad.video_url) return;
    if (isActive) {
      v.play().then(() => {}, () => {});
    } else {
      v.pause();
    }
  }, [isActive, ad.video_url]);

  // Track story/reel completion (video watched to >80%)
  const handleTimeUpdate = useCallback(() => {
    if (completionTracked.current) return;
    const v = videoRef.current;
    if (!v || !v.duration) return;
    if (v.currentTime / v.duration >= 0.8) {
      completionTracked.current = true;
      const watchSeconds = Math.round((Date.now() - watchStartRef.current) / 1000);
      supabase.from('ad_impressions').insert({
        ad_id: ad.id,
        user_id: user?.id ?? null,
        clicked: false,
        completed: true,
        skipped: false,
        watch_seconds: watchSeconds,
      }).then(() => {}, () => {});
    }
  }, [ad.id, user?.id]);

  // Handle skip button click
  const handleSkip = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canSkip) return;
    if (!skipTracked.current) {
      skipTracked.current = true;
      const watchSeconds = Math.round((Date.now() - watchStartRef.current) / 1000);
      supabase.from('ad_impressions').insert({
        ad_id: ad.id,
        user_id: user?.id ?? null,
        clicked: false,
        skipped: true,
        completed: false,
        watch_seconds: watchSeconds,
      }).then(() => {}, () => {});
    }
    setDismissed(true);
  }, [canSkip, ad.id, user?.id]);

  const handleClick = () => {
    supabase.from('ad_impressions').insert({ ad_id: ad.id, user_id: user?.id ?? null, clicked: true }).then(() => {}, () => {});
    if (ad.target_url) window.open(ad.target_url, '_blank', 'noopener,noreferrer');
  };

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !liked;
    setLiked(next);
    if (next) {
      setLikeCount(c => c + 1);
      supabase.from('ad_impressions').insert({ ad_id: ad.id, user_id: user?.id ?? null, clicked: true }).then(() => {}, () => {});
    } else {
      setLikeCount(c => Math.max(0, c - 1));
    }
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    supabase.from('ad_impressions').insert({ ad_id: ad.id, user_id: user?.id ?? null, clicked: true }).then(() => {}, () => {});
    if (ad.target_url) {
      navigator.clipboard.writeText(ad.target_url).then(() => toast.success('Ad link copied!')).then(() => {}, () => {});
    }
  };

  if (dismissed) return null;

  const advertiserName = ad.user_profiles?.username ?? 'Sponsored';
  const advertiserAvatar = ad.user_profiles?.avatar_url;
  const isVerified = ad.user_profiles?.verified;
  let domainShort = '';
  if (ad.target_url) {
    try { domainShort = new URL(ad.target_url).hostname.replace(/^www\./, ''); } catch {}
  }
  const bodyText = ad.description ?? '';
  const SHORT_LIMIT = 80;
  const isLong = bodyText.length > SHORT_LIMIT;
  const displayBody = expanded || !isLong ? bodyText : bodyText.slice(0, SHORT_LIMIT) + '…';
  const ctaLabel = ad.target_url?.includes('sign') || ad.target_url?.includes('register')
    ? 'Sign up'
    : ad.target_url?.includes('shop') || ad.target_url?.includes('buy')
    ? 'Shop now'
    : domainShort
    ? `GET ${domainShort.toUpperCase().slice(0, 12)}`
    : 'Learn more';

  return (
    <div className="relative w-full bg-black overflow-hidden" style={{ height: '100svh', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}>
      {/* ── Full-screen creative ── */}
      {ad.video_url ? (
        <video
          ref={videoRef}
          src={ad.video_url}
          className="absolute inset-0 w-full h-full object-cover"
          loop
          muted={muted}
          playsInline
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
        />
      ) : ad.image_url ? (
        <img
          src={ad.image_url}
          alt={ad.title}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/40 via-primary/20 to-black" />
      )}

      {/* Gradient overlay — dark top and bottom for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent via-40% to-black/80 pointer-events-none" />

      {/* ── Mute toggle (video only) ── */}
      {ad.video_url && (
        <button
          onClick={e => { e.stopPropagation(); setMuted(m => !m); }}
          className="absolute top-14 right-4 z-20 w-9 h-9 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20"
        >
          {muted
            ? <VolumeX className="w-4 h-4 text-white" />
            : <Volume2 className="w-4 h-4 text-white" />}
        </button>
      )}

      {/* ── Dismiss (X) ── */}
      <button
        onClick={e => { e.stopPropagation(); setDismissed(true); }}
        className="absolute top-14 left-4 z-20 w-9 h-9 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20"
      >
        <X className="w-4 h-4 text-white" />
      </button>

      {/* ── Skip Ad Button (bottom-right, 5s countdown then skip) ── */}
      <div className="absolute bottom-40 right-4 z-20">
        {canSkip ? (
          <button
            onClick={handleSkip}
            className="flex items-center gap-1.5 bg-black/70 backdrop-blur-sm border border-white/30 rounded-full px-4 py-2 text-white text-xs font-bold hover:bg-white/20 active:scale-95 transition-all animate-in fade-in duration-200"
          >
            Skip Ad
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 3l10 5-10 5V3zm10 4V3l3 5-3 5V7z" />
            </svg>
          </button>
        ) : (
          <div className="relative w-12 h-12 flex items-center justify-center">
            {/* Circular countdown SVG ring */}
            <svg className="absolute inset-0 w-12 h-12 -rotate-90" viewBox="0 0 48 48">
              <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
              <circle
                cx="24" cy="24" r="20"
                fill="none"
                stroke="rgba(255,255,255,0.8)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 20}`}
                strokeDashoffset={`${2 * Math.PI * 20 * (skipCountdown / 5)}`}
                style={{ transition: 'stroke-dashoffset 0.9s linear' }}
              />
            </svg>
            <span className="text-white text-xs font-black z-10">{skipCountdown}</span>
          </div>
        )}
      </div>

      {/* ── Bottom overlay content ── */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-4 pb-6 space-y-3">

        {/* Advertiser header */}
        <div className="flex items-center gap-2.5">
          <div
            className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/70 shrink-0 cursor-pointer"
            onClick={() => ad.user_profiles && navigate(`/profile/${advertiserName}`)}
          >
            {advertiserAvatar
              ? <img src={advertiserAvatar} alt={advertiserName} className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-primary flex items-center justify-center font-bold text-white text-sm">{advertiserName[0]?.toUpperCase()}</div>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-white font-bold text-sm truncate">{advertiserName}</span>
              {isVerified && <BadgeCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="currentColor" />}
            </div>
            <div className="flex items-center gap-1 text-white/60 text-[11px]">
              <Globe className="w-2.5 h-2.5" />
              <span>Sponsored</span>
            </div>
          </div>
          <button className="w-8 h-8 flex items-center justify-center text-white/60">
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>

        {/* Ad title */}
        <p className="text-white font-bold text-base leading-tight">{ad.title}</p>

        {/* Body copy */}
        <p className="text-white/80 text-sm leading-relaxed">
          {displayBody}
          {isLong && !expanded && (
            <button onClick={e => { e.stopPropagation(); setExpanded(true); }} className="text-white font-bold ml-1">
              more
            </button>
          )}
        </p>

        {/* Link preview strip + CTA */}
        {domainShort && (
          <div
            onClick={handleClick}
            className="flex items-center justify-between bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-3 py-2.5 cursor-pointer hover:bg-white/15 transition-colors"
          >
            <div className="min-w-0 flex-1 mr-2">
              <p className="text-white/50 text-[10px] uppercase tracking-wide font-medium truncate">{domainShort}</p>
              <p className="text-white font-semibold text-sm truncate">{ad.title}</p>
            </div>
            <button
              onClick={handleClick}
              className="shrink-0 px-4 py-2 bg-white text-black font-bold text-sm rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              {ctaLabel}
            </button>
          </div>
        )}

        {/* Engagement row */}
        <div className="flex items-center gap-1 pt-1 border-t border-white/10">
          <button
            onClick={handleLike}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              liked ? 'text-blue-400' : 'text-white/80 hover:text-white'
            }`}
          >
            <ThumbsUp className={`w-4 h-4 ${liked ? 'fill-blue-400' : ''}`} />
            <span>{formatNumber(likeCount)}</span>
          </button>
          <button
            onClick={e => { e.stopPropagation(); supabase.from('ad_impressions').insert({ ad_id: ad.id, user_id: user?.id ?? null, clicked: true }).then(() => {}, () => {}); }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold text-white/80 hover:text-white transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            <span>{formatNumber(commentCount)}</span>
          </button>
          <button
            onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold text-white/80 hover:text-white transition-colors"
          >
            <Share2 className="w-4 h-4" />
            <span>{formatNumber(shareCount)}</span>
          </button>
        </div>
      </div>

      {/* ── Right side action bar (TikTok-style) ── */}
      <div className="absolute right-3 bottom-48 z-20 flex flex-col gap-5 items-center">
        <button
          onClick={handleLike}
          className="flex flex-col items-center gap-1"
        >
          <div className={`w-11 h-11 rounded-full flex items-center justify-center ${liked ? 'bg-blue-500' : 'bg-black/50 backdrop-blur-sm border border-white/20'}`}>
            <ThumbsUp className={`w-5 h-5 ${liked ? 'text-white fill-white' : 'text-white'}`} />
          </div>
          <span className="text-white text-[10px] font-bold">{formatNumber(likeCount)}</span>
        </button>
        <button
          onClick={() => { if (ad.target_url) window.open(ad.target_url, '_blank', 'noopener,noreferrer'); }}
          className="flex flex-col items-center gap-1"
        >
          <div className="w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center">
            <ExternalLink className="w-5 h-5 text-white" />
          </div>
          <span className="text-white text-[10px] font-bold">Visit</span>
        </button>
        <button
          onClick={handleShare}
          className="flex flex-col items-center gap-1"
        >
          <div className="w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center">
            <Share2 className="w-5 h-5 text-white" />
          </div>
          <span className="text-white text-[10px] font-bold">{formatNumber(shareCount)}</span>
        </button>
      </div>

      {/* ── "Ad" badge — bottom-left corner, Facebook Reels pattern ── */}
      <div className="absolute bottom-[calc(theme(spacing.6)_+_80px)] left-4 z-20">
        <div className="flex items-center gap-1 bg-black/60 backdrop-blur-sm border border-white/20 rounded-full px-2.5 py-1">
          <Megaphone className="w-3 h-3 text-white/80" />
          <span className="text-white/80 text-[11px] font-bold">Ad</span>
        </div>
      </div>

      {/* ── Animated CTA marquee at very bottom (GET OPENFLOAT-style) ── */}
      {domainShort && (
        <div
          onClick={handleClick}
          className="absolute bottom-0 left-0 right-0 z-20 bg-primary/95 backdrop-blur-sm py-3 flex items-center justify-center gap-3 cursor-pointer hover:opacity-90 transition-opacity"
        >
          <span className="text-primary-foreground text-sm font-black tracking-wider uppercase animate-pulse">
            ‹‹ {ctaLabel} ››
          </span>
        </div>
      )}
    </div>
  );
}
