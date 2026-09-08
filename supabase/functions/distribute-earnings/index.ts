import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const CPM: Record<string, number> = { standard: 1.5, rising: 2, premium: 2.5, top_creator: 3.5 };
const AD_CREATOR_SHARE = 0.40;

function tier(verified: boolean, views: number) {
  if (verified && views >= 100_000) return 'top_creator';
  if (verified) return 'premium';
  if (views >= 10_000) return 'rising';
  return 'standard';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const results = { videoFund: 0, adRevenue: 0, ratesUpdated: 0, errors: [] as string[] };

    const { data: creators, error: creatorErr } = await supabase
      .from('profiles').select('id,verified');
    if (creatorErr) throw creatorErr;
    const ids = (creators ?? []).map((c: any) => c.id);

    const { data: videos, error: videoErr } = await supabase
      .from('posts').select('id,user_id,author_id,views_count,is_video,fund_earnings_paid')
      .eq('is_video', true).gte('views_count', 0).in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    if (videoErr) results.errors.push(`videos: ${videoErr.message}`);

    const viewsByCreator: Record<string, number> = {};
    for (const v of (videos ?? [])) {
      const owner = v.user_id ?? v.author_id;
      if (owner) viewsByCreator[owner] = (viewsByCreator[owner] ?? 0) + Number(v.views_count ?? 0);
    }

    for (const c of (creators ?? [])) {
      const totalViews = viewsByCreator[c.id] ?? 0;
      const t = tier(Boolean(c.verified), totalViews);
      await supabase.from('video_revenue_rates').upsert({
        user_id: c.id, tier: t, cpm_usd: CPM[t], period_views: totalViews,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      results.ratesUpdated++;
    }

    for (const v of (videos ?? [])) {
      if (v.fund_earnings_paid || Number(v.views_count ?? 0) < 1000) continue;
      const owner = v.user_id ?? v.author_id;
      if (!owner) continue;
      const creator = (creators ?? []).find((c: any) => c.id === owner);
      const t = tier(Boolean(creator?.verified), viewsByCreator[owner] ?? 0);
      const earned = Math.floor(Number(v.views_count) / 1000) * (CPM[t] / 1000);
      if (earned <= 0) continue;

      const { error: settleErr } = await supabase.rpc('settle_monetization_event', {
        p_payer_id: null,
        p_creator_id: owner,
        p_event_type: 'creator_fund',
        p_gross_amount: earned,
        p_currency: 'USD',
        p_provider: 'creator_fund',
        p_provider_reference: `video_fund:${v.id}`,
        p_metadata: { post_id: v.id, views: Number(v.views_count), tier: t, cpm: CPM[t] },
      });
      if (settleErr) { results.errors.push(`fund ${v.id}: ${settleErr.message}`); continue; }
      await supabase.from('posts').update({ fund_earnings_paid: true }).eq('id', v.id);
      results.videoFund += earned;
    }

    const { data: ads } = await supabase.from('ad_placements').select('id,revenue,currency').eq('status','completed');
    const adRevenue = (ads ?? []).reduce((sum: number, a: any) => sum + Number(a.revenue ?? 0), 0);
    const distributable = adRevenue * AD_CREATOR_SHARE;
    const totalViews = Object.values(viewsByCreator).reduce((s, v) => s + v, 0);
    if (distributable > 0 && totalViews > 0) {
      for (const [creatorId, views] of Object.entries(viewsByCreator)) {
        if (views <= 0) continue;
        const share = distributable * (views / totalViews);
        if (share < 0.01) continue;
        const monthKey = new Date().toISOString().slice(0, 7);
        const { error: e } = await supabase.rpc('settle_monetization_event', {
          p_payer_id: null, p_creator_id: creatorId, p_event_type: 'ad_revenue',
          p_gross_amount: share / AD_CREATOR_SHARE, p_currency: 'USD',
          p_provider: 'ad_revenue', p_provider_reference: `ads:${monthKey}:${creatorId}`,
          p_metadata: { month: monthKey, creator_views: views, total_views: totalViews, creator_share: AD_CREATOR_SHARE },
        });
        if (!e) results.adRevenue += share;
        else results.errors.push(`ads ${creatorId}: ${e.message}`);
      }
    }

    return new Response(JSON.stringify({ ok: results.errors.length === 0, ...results }), {
      status: results.errors.length ? 207 : 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
