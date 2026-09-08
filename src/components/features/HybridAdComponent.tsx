import { useState, useEffect } from 'react';
import { Capacitor, BannerAdPosition } from '@/lib/capacitor-stub';
import { AdSenseAd } from './AdSenseAd';
import { AdMobAd } from './AdMobAd';
import { supabase } from '@/lib/supabase';

interface HybridAdProps {
  location: 'feed_top' | 'feed_inline' | 'sidebar' | 'profile' | 'explore';
  className?: string;
  position?: BannerAdPosition;
}

export function HybridAdComponent({ location, className = '', position }: HybridAdProps) {
  const [adConfig, setAdConfig] = useState<{ adId: string; type: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const isMobile = Capacitor.isNativePlatform();

  useEffect(() => { fetchAdConfig(); }, [location]);

  const fetchAdConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('ad_placements').select('*').eq('network', 'adsense').eq('location', location).eq('is_active', true).single();
      if (error || !data) { setLoading(false); return; }
      setAdConfig({ adId: data.code, type: data.placement_type });
      await trackImpression(data.id);
    } catch (error) {
      console.error('Error fetching ad config:', error);
    } finally { setLoading(false); }
  };

  const trackImpression = async (adPlacementId: string) => {
    try {
      await supabase.rpc('track_ad_view', { ad_id_param: adPlacementId, user_id_param: null });
    } catch (error) { console.error('Error tracking impression:', error); }
  };

  if (loading || !adConfig) return null;
  if (isMobile) {
    return <div className={className}><AdMobAd adId={adConfig.adId} type={adConfig.type as 'banner' | 'interstitial' | 'rewarded'} position={position} onAdLoaded={() => console.log('AdMob ad loaded')} onAdFailed={(error) => console.error('AdMob error:', error)} /></div>;
  }
  return <div className={className}><AdSenseAd adSlot={adConfig.adId} adFormat="auto" fullWidthResponsive={true} onAdLoad={() => console.log('AdSense ad loaded')} /></div>;
}
