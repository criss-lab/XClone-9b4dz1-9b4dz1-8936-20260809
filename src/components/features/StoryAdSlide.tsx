/**
 * StoryAdSlide — Full-screen 9:16 story-format ad injected between story groups.
 * Tracks impressions, completions, skips in ad_impressions with story_format=true.
 * Frequency cap: max 2 story ads per user per 24h (localStorage).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Globe, ExternalLink, BadgeCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export interface StoryAdData {
  id: string;
  title: string;
  description: string;
  image_url?: string | null;
  video_url?: string | null;
  target_url?: string | null;
  impressions?: number;
  user_profiles?: {
    username: string;
    avatar_url?: string | null;
    verified?: boolean;
  } | null;
}

interface StoryAdSlideProps {
  ad: StoryAdData;
  onComplete: () => void;
  onSkip: () => void;
}

// ── Story Ad Frequency Cap: max 2 story-format ads per user per 24h ──────────
const STORY_AD_CAP = 2;
const STORY_AD_KEY = 'ts-storyad-freq';
export function checkStoryAdFreqCap(): boolean {
  try {
    const raw = localStorage.getItem(STORY_AD_KEY);
    const stamps: number[] = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return stamps.filter(t => t > cutoff).length >= STORY_AD_CAP;
  } catch { return false; }
}
function recordStoryAdImpression(): void {
  try {
    const raw = localStorage.getItem(STORY_AD_KEY);
    const stamps: number[] = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = stamps.filter(t => t > cutoff);
    recent.push(Date.now());
    localStorage.setItem(STORY_AD_KEY, JSON.stringify(recent));
  } catch {}
}

export function StoryAdSlide({ ad, onComplete, onSkip }: StoryAdSlideProps) {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const impressionTracked = useRef(false);
  const completionTracked = useRef(false);
  const watchStartRef = useRef(Date.now());
  const [progress, setProgress] = useState(0);
  const [canSkip, setCanSkip] = useState(false);
  const [skipCountdown, setSkipCountdown] = useState(3);
  const DURATION_MS = 8000;

  // Track impression on mount
  useEffect(() => {
    if (impressionTracked.current) return;
    impressionTracked.current = true;
    watchStartRef.current = Date.now();
    recordStoryAdImpression();
    supabase.from('ad_impressions').insert({
      ad_id: ad.id,
      user_id: user?.id ?? null,
      clicked: false,
      skipped: false,
      completed: false,
      story_format: true,
    }).then(() => {}, () => {});
  }, [ad.id, user?.id]);

  // Auto-advance progress bar
  useEffect(() => {
    const start = Date.now();
    let skipFired = false;
    const iv = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / DURATION_MS) * 100, 100);
      setProgress(pct);

      // Skip button after 3s
      if (!skipFired && elapsed >= 3000) {
        skipFired = true;
        setCanSkip(true);
        setSkipCountdown(0);
      } else if (!skipFired) {
        setSkipCountdown(Math.ceil((3000 - elapsed) / 1000));
      }

      if (pct >= 100) {
        clearInterval(iv);
        if (!completionTracked.current) {
          completionTracked.current = true;
          const watchSeconds = Math.round((Date.now() - watchStartRef.current) / 1000);
          supabase.from('ad_impressions').insert({
            ad_id: ad.id,
            user_id: user?.id ?? null,
            clicked: false,
            completed: true,
            skipped: false,
            watch_seconds: watchSeconds,
            story_format: true,
          }).then(() => {}, () => {});
        }
        onComplete();
      }
    }, 50);
    return () => clearInterval(iv);
  }, [ad.id, user?.id, onComplete]);

  const handleSkip = useCallback(() => {
    if (!canSkip) return;
    const watchSeconds = Math.round((Date.now() - watchStartRef.current) / 1000);
    supabase.from('ad_impressions').insert({
      ad_id: ad.id,
      user_id: user?.id ?? null,
      clicked: false,
      skipped: true,
      completed: false,
      watch_seconds: watchSeconds,
      story_format: true,
    }).then(() => {}, () => {});
    onSkip();
  }, [canSkip, ad.id, user?.id, onSkip]);

  const handleClick = () => {
    supabase.from('ad_impressions').insert({
      ad_id: ad.id,
      user_id: user?.id ?? null,
      clicked: true,
      story_format: true,
    }).then(() => {}, () => {});
    if (ad.target_url) window.open(ad.target_url, '_blank', 'noopener,noreferrer');
  };

  const advertiserName = ad.user_profiles?.username ?? 'Sponsored';
  const advertiserAvatar = ad.user_profiles?.avatar_url;
  const isVerified = ad.user_profiles?.verified;
  let domainShort = '';
  if (ad.target_url) {
    try { domainShort = new URL(ad.target_url).hostname.replace(/^www\./, ''); } catch {}
  }

  return (
    <div className="fixed inset-0 z-[400] bg-black select-none" onClick={handleClick}>
      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/20 z-30">
        <div className="h-full bg-white transition-none" style={{ width: `${progress}%` }} />
      </div>

      {/* Media */}
      {ad.video_url ? (
        <video
          ref={videoRef}
          src={ad.video_url}
          autoPlay
          muted
          playsInline
          loop
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : ad.image_url ? (
        <img
          src={ad.image_url}
          alt={ad.title}
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/40 via-primary/20 to-black" />
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80 pointer-events-none" />

      {/* Header */}
      <div className="absolute top-6 left-3 right-3 z-30 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-white/70 shrink-0">
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
        {/* Skip / countdown */}
        <button
          onClick={e => { e.stopPropagation(); handleSkip(); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
            canSkip
              ? 'bg-black/70 border-white/30 text-white hover:bg-white/20 active:scale-95'
              : 'bg-black/40 border-white/15 text-white/50 cursor-not-allowed'
          }`}
        >
          {canSkip ? (
            <>Skip <X className="w-3 h-3" /></>
          ) : (
            <>Skip in {skipCountdown}s</>
          )}
        </button>
      </div>

      {/* Bottom CTA */}
      <div className="absolute bottom-8 left-4 right-4 z-30 space-y-2" onClick={e => e.stopPropagation()}>
        <p className="text-white font-bold text-lg leading-snug">{ad.title}</p>
        <p className="text-white/80 text-sm line-clamp-2">{ad.description}</p>
        {domainShort && (
          <button
            onClick={handleClick}
            className="w-full py-3 bg-white text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all"
          >
            <ExternalLink className="w-4 h-4" />
            Visit {domainShort}
          </button>
        )}
      </div>

      {/* Ad badge */}
      <div className="absolute bottom-24 right-4 z-30" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1 bg-black/60 backdrop-blur-sm border border-white/20 rounded-full px-2 py-0.5">
          <Globe className="w-2.5 h-2.5 text-white/70" />
          <span className="text-white/70 text-[10px] font-bold">Ad</span>
        </div>
      </div>
    </div>
  );
}
