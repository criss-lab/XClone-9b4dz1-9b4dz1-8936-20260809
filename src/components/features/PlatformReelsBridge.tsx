import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PlaySquare } from 'lucide-react';

/**
 * Makes the immersive Reels player the platform-wide video destination.
 * Any ordinary feed/profile/community video gets a small "Open in Reels"
 * affordance; double-clicking the video itself also opens the same player.
 */
export function PlatformReelsBridge() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/videos') return;
    const open = (video: HTMLVideoElement) => {
      const src = video.currentSrc || video.src;
      if (!src) return;
      const url = new URL('/videos', window.location.origin);
      url.searchParams.set('start', src);
      navigate(`${url.pathname}${url.search}`);
    };
    const onDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const video = target?.closest('video');
      if (video instanceof HTMLVideoElement) {
        event.preventDefault();
        open(video);
      }
    };
    document.addEventListener('dblclick', onDoubleClick, true);
    return () => document.removeEventListener('dblclick', onDoubleClick, true);
  }, [location.pathname, navigate]);

  return null;
}

export function ReelsOpenButton({ videoUrl, label = 'Open in Reels' }: { videoUrl: string; label?: string }) {
  const navigate = useNavigate();
  const open = () => {
    const url = new URL('/videos', window.location.origin);
    url.searchParams.set('start', videoUrl);
    navigate(`${url.pathname}${url.search}`);
  };
  return <button type="button" onClick={open} aria-label={label} className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-black/85"><PlaySquare className="h-3.5 w-3.5" />{label}</button>;
}
