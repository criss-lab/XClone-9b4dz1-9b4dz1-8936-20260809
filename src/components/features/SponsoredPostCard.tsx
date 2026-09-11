import { useEffect } from 'react';
import { ExternalLink, BadgeCheck, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { parseContent } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface SponsoredPostCardProps {
  post: any; // user_ads row with user_profiles joined, or personalized ad RPC result
}

export function SponsoredPostCard({ post }: SponsoredPostCardProps) {
  useEffect(() => {
    // Track impression — use rpc increment to avoid race conditions
    if (post.ad_id || post.id) {
      const adId = post.ad_id ?? post.id;
      supabase.rpc('track_ad_view', { ad_id_param: adId }).catch(() => {
        // Fallback: direct update
        supabase.from('user_ads').update({ impressions: (post.impressions ?? 0) + 1 }).eq('id', adId).then(() => {}, () => {});
      });
    }
  }, [post.ad_id ?? post.id]);

  const handleClick = async () => {
    const adId = post.ad_id ?? post.id;
    if (adId) {
      await supabase.from('user_ads').update({ clicks: (post.clicks ?? 0) + 1 }).eq('id', adId).then(() => {}, () => {});
    }
    const url = post.target_url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Support both direct user_ads row and get_personalized_ads RPC result
  const advertiserName = post.advertiser_name ?? post.user_profiles?.username ?? 'Advertiser';
  const advertiserAvatar = post.advertiser_avatar ?? post.user_profiles?.avatar_url;
  const advertiserVerified = post.advertiser_verified ?? post.user_profiles?.verified ?? false;
  const adTitle = post.title ?? '';
  const adDescription = post.description ?? '';
  const adImage = post.image_url;
  const adVideoUrl = post.video_url;
  const adUrl = post.target_url;
  const createdAt = post.created_at;

  return (
    <div className="border-b border-border hover:bg-muted/5 transition-colors">
      <div className="p-4">
        {/* Header — looks like a normal post header */}
        <div className="flex gap-3">
          <div
            className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/30 to-primary/60 flex-shrink-0 overflow-hidden flex items-center justify-center text-primary-foreground font-bold cursor-pointer"
            onClick={handleClick}
          >
            {advertiserAvatar ? (
              <img src={advertiserAvatar} alt={advertiserName} className="w-full h-full object-cover" />
            ) : (
              advertiserName[0]?.toUpperCase()
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
              <span className="font-bold text-foreground text-sm cursor-pointer hover:underline" onClick={handleClick}>
                {advertiserName}
              </span>
              {advertiserVerified && <BadgeCheck className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" />}
              {/* Native "Sponsored" label — subtle, inline */}
              <span className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                <Sparkles className="w-2.5 h-2.5" /> Sponsored
              </span>
              {createdAt && (
                <span className="text-muted-foreground text-xs">
                  · {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
                </span>
              )}
            </div>

            {/* Ad body — styled like a post */}
            {adTitle && (
              <p className="font-bold text-base leading-snug mb-1">{adTitle}</p>
            )}
            {adDescription && (
              <div
                className="text-foreground text-sm leading-relaxed whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: parseContent(adDescription) }}
              />
            )}

            {/* Media */}
            {adImage && (
              <div className="mt-3 rounded-2xl overflow-hidden border border-border cursor-pointer" onClick={handleClick}>
                <img src={adImage} alt={adTitle || 'Sponsored'} className="w-full max-h-80 object-cover" loading="lazy" />
              </div>
            )}

            {adVideoUrl && !adImage && (
              <div className="mt-3 rounded-2xl overflow-hidden bg-black border border-border max-h-80">
                <video controls className="w-full h-full max-h-80 object-contain" playsInline preload="metadata">
                  <source src={adVideoUrl} type="video/mp4" />
                </video>
              </div>
            )}

            {/* CTA button */}
            {adUrl && (
              <div className="mt-3">
                <button
                  onClick={handleClick}
                  className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-full transition-all text-sm"
                >
                  Learn More <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
