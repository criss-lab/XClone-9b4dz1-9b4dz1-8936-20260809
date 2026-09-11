import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Capacitor } from '@/lib/capacitor-stub';
import { usePremium } from '@/hooks/usePremium';

interface DynamicAdProps {
  location: 'feed_top' | 'feed_inline' | 'sidebar' | 'profile' | 'explore';
  className?: string;
}

interface AdPlacement {
  id: string;
  network: string;
  placement_type: string;
  code: string;
  location: string;
}

// Track slots already pushed to avoid double-push
const pushedSlots: Set<string> = /* @__PURE__ */ new Set<string>();

export function DynamicAd({ location, className = '' }: DynamicAdProps) {
  const [adPlacements, setAdPlacements] = useState<AdPlacement[]>([]);
  const [loading, setLoading] = useState(true);
  const isNative = Capacitor.isNativePlatform();
  const { isActive: isPremium } = usePremium();

  useEffect(() => {
    fetchAds();
  }, [location]);

  const fetchAds = async () => {
    try {
      const { data } = await supabase.rpc('get_active_ads', { location_filter: location });
      const filtered = isNative
        ? (data || []).filter((a: AdPlacement) => a.network !== 'adsense')
        : (data || []);
      setAdPlacements(filtered);
    } catch {
      // silent — ads are non-critical
    } finally {
      setLoading(false);
    }
  };

  const trackImpression = async (adId: string) => {
    supabase.rpc('track_ad_view', { ad_id_param: adId, user_id_param: null }).then(() => {}, () => {});
  };

  if (isPremium) return null; // Ad-free for premium users
  if (loading || adPlacements.length === 0) return null;
  if (isNative) return null;

  const ad = adPlacements[0];
  if (!ad.code) return null;

  if (ad.network === 'adsense') {
    return (
      <div className={className}>
        <WebAdSense adSlot={ad.code} adId={ad.id} onLoad={() => trackImpression(ad.id)} />
      </div>
    );
  }

  return null;
}

function WebAdSense({ adSlot, adId, onLoad }: { adSlot: string; adId: string; onLoad: () => void }) {
  const insRef  = useRef<HTMLModElement>(null);
  const key     = `${adId}-${adSlot}`;
  const [filled, setFilled] = useState<boolean | null>(null);

  useEffect(() => {
    if (pushedSlots.has(key)) return;
    const timer = setTimeout(() => {
      try {
        if (typeof window !== 'undefined') {
          ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
          pushedSlots.add(key);
          onLoad();
        }
      } catch (_) {}
    }, 300);

    // Check fill status after AdSense has had time to respond
    const checkFill = () => {
      const el = insRef.current;
      if (!el) { setFilled(false); return; }
      const status = el.getAttribute('data-ad-status');
      if (status === 'unfilled') { setFilled(false); return; }
      setFilled(el.children.length > 0 || (el as any).offsetHeight > 4);
    };
    const t1 = setTimeout(checkFill, 1800);
    const t2 = setTimeout(checkFill, 3500);

    return () => { clearTimeout(timer); clearTimeout(t1); clearTimeout(t2); };
  }, [key, onLoad]);

  // Collapse completely if unfilled — no dead space
  if (filled === false) return null;

  return (
    <div>
      {/* Native-style ad label */}
      <div className="flex items-center gap-1.5 mb-1 px-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Sponsored</span>
        <span className="text-[9px] font-bold uppercase tracking-widest px-1 py-0.5 rounded-sm bg-amber-500/10 text-amber-500 border border-amber-500/15">Ad</span>
      </div>
      {/* No minHeight — collapses if empty */}
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client="ca-pub-2458567543017441"
        data-ad-slot={adSlot}
        data-ad-format="fluid"
        data-ad-layout="in-article"
        data-full-width-responsive="true"
      />
    </div>
  );
}

declare global {
  interface Window { adsbygoogle: any[]; }
}
