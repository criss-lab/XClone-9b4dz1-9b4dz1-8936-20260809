import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const CPM_TIERS = { top_creator: 3.50, premium: 2.50, rising: 2.00, standard: 1.50 } as const;
type Tier = keyof typeof CPM_TIERS;
const AD_REVENUE_SHARE = 0.40;

function getTier(verified: boolean, totalViews: number): Tier {
  if (verified && totalViews >= 100_000) return 'top_creator';
  if (verified) return 'premium';
  if (totalViews >= 10_000) return 'rising';
  return 'standard';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
  const result = { videoFund: 0, adRevenue: 0, ratesUpdated: 0, errors: [] as string[] };

  try {
    const auth = req.headers.get('authorization') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (auth !== `Bearer ${serviceKey}`) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: creators, error: creatorsErr } = await admin.from('user_profiles').select('id,verified').eq('is_creator', true);
    if (creatorsErr) throw creatorsErr;
    const creatorIds = (creators ?? []).map((c: any) => c.id);

    if (creatorIds.length) {
      const { data: videos, error: viewsErr } = await admin.from('posts').select('user_id,views_count').eq('is_video', true).in('user_id', creatorIds);
      if (viewsErr) throw viewsErr;
      const viewsByCreator: Record<string, number> = {};
      for (const row of videos ?? []) viewsByCreator[row.user_id] = (viewsByCreator[row.user_id] ?? 0) + Number(row.views_count ?? 0);

      for (const creator of creators ?? []) {
        const totalViews = viewsByCreator[creator.id] ?? 0;
        const tier = getTier(Boolean(creator.verified), totalViews);
        const { error } = await admin.from('video_revenue_rates').upsert({ user_id: creator.id, tier, cpm_usd: CPM_TIERS[tier], period_views: totalViews, last_updated: new Date().toISOString() }, { onConflict: 'user_id' });
        if (error) result.errors.push(`rate:${creator.id}:${error.message}`); else result.ratesUpdated++;
      }

      const { data: unpaidVideos, error: unpaidErr } = await admin.from('posts').select('id,user_id,views_count').eq('is_video', true).eq('fund_earnings_paid', false).gte('views_count', 1000);
      if (unpaidErr) throw unpaidErr;
      for (const video of unpaidVideos ?? []) {
        const creator = (creators ?? []).find((c: any) => c.id === video.user_id);
        const tier = getTier(Boolean(creator?.verified), viewsByCreator[video.user_id] ?? 0);
        const earned = Math.floor(Number(video.views_count) / 1000) * CPM_TIERS[tier];
        if (earned <= 0) continue;
        const { error } = await admin.rpc('post_creator_earning_atomic', { p_user_id: video.user_id, p_amount: earned, p_source: 'video_fund', p_source_id: String(video.id), p_currency: 'USD', p_post_id: video.id, p_metadata: { tier, views: Number(video.views_count) } });
        if (error) { result.errors.push(`video:${video.id}:${error.message}`); continue; }
        const { error: markErr } = await admin.from('posts').update({ fund_earnings_paid: true }).eq('id', video.id).eq('fund_earnings_paid', false);
        if (markErr) { result.errors.push(`mark:${video.id}:${markErr.message}`); continue; }
        result.videoFund += earned;
      }
    }

    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const periodEnd = new Date(nextMonth.getTime() - 1).toISOString().slice(0, 10);
    const { data: monetized } = await admin.from('user_monetization').select('user_id').eq('is_monetized', true).gt('total_views', 0);
    const monetizedIds = (monetized ?? []).map((x: any) => x.user_id);
    if (monetizedIds.length) {
      const { data: monthPosts } = await admin.from('posts').select('user_id,views_count').in('user_id', monetizedIds).gte('created_at', monthStart.toISOString()).lt('created_at', nextMonth.toISOString());
      const views: Record<string, number> = {};
      for (const row of monthPosts ?? []) views[row.user_id] = (views[row.user_id] ?? 0) + Number(row.views_count ?? 0);
      const totalViews = Object.values(views).reduce((a, b) => a + b, 0);
      const { data: ads } = await admin.from('ad_placements').select('revenue').gte('created_at', monthStart.toISOString()).lt('created_at', nextMonth.toISOString());
      const gross = (ads ?? []).reduce((a: number, b: any) => a + Number(b.revenue ?? 0), 0);
      const pool = gross * AD_REVENUE_SHARE;
      if (pool > 0.01 && totalViews > 0) {
        for (const [userId, creatorViews] of Object.entries(views)) {
          if (!creatorViews) continue;
          const share = (creatorViews / totalViews) * pool;
          if (share < 0.001) continue;
          const { error } = await admin.rpc('post_ad_revenue_atomic', { p_user_id: userId, p_amount: Number(share.toFixed(6)), p_period_start: monthStart.toISOString().slice(0, 10), p_period_end: periodEnd, p_views: creatorViews, p_total_views: totalViews, p_gross_revenue: gross, p_currency: 'USD' });
          if (error) result.errors.push(`ad:${userId}:${error.message}`); else result.adRevenue += share;
        }
      }
    }

    await admin.from('audit_logs').insert({ action: 'earnings_distribution_run', resource_type: 'creator_earnings', status: result.errors.length ? 'partial' : 'success', metadata: result });
    return new Response(JSON.stringify({ ok: true, ...result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[distribute-earnings]', message);
    await admin.from('audit_logs').insert({ action: 'earnings_distribution_failed', resource_type: 'creator_earnings', status: 'failed', metadata: { error: message } }).catch(() => undefined);
    return new Response(JSON.stringify({ ok: false, error: message, ...result }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
