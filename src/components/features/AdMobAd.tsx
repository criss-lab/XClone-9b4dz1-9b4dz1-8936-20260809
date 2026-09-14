import { useEffect, useRef } from 'react';
import { BannerAdPosition } from '@/lib/capacitor-stub';

interface AdMobAdProps {
  adId?: string;
  type: 'banner' | 'interstitial' | 'rewarded';
  position?: BannerAdPosition;
  onAdLoaded?: () => void;
  onAdFailed?: (error: any) => void;
  onRewarded?: (reward: any) => void;
}

export function AdMobAd({ type, onAdLoaded }: AdMobAdProps) {
  const pushed = useRef(false);

  useEffect(() => {
    if (type !== 'banner') return;
    if (pushed.current) return;
    pushed.current = true;
    try {
      ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
      onAdLoaded?.();
    } catch (_) {}
  }, [type, onAdLoaded]);

  if (type !== 'banner') return null;

  return (
    <div className="w-full rounded-xl overflow-hidden border border-border bg-muted/5">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground px-3 pt-2 mb-1">Sponsored</p>
      <ins
        className="adsbygoogle"
        style={{ display: 'block', minHeight: 60 }}
        data-ad-client="ca-pub-2458567543017441"
        data-ad-slot="2031881558"
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}

export const useAdMob = () => ({
  showInterstitial: async (_id?: string) => false,
  showRewarded: async (_id?: string) => null,
  showBanner: async (_id?: string, _pos?: BannerAdPosition) => {},
  hideBanner: async () => {},
});
