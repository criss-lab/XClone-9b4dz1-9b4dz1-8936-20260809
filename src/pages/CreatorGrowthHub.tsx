import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSEO } from '@/hooks/useSEO';
import { supabase } from '@/lib/supabase';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import {
  BarChart3, CheckCircle2, ChevronRight, DollarSign, Eye, Megaphone,
  Play, Rocket, ShieldCheck, Sparkles, Target, Users, Wallet, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

const FOLLOWER_REQUIREMENT = 400;

type Post = {
  id: string;
  content: string | null;
  image_url: string | null;
  video_url: string | null;
  is_video: boolean | null;
  views_count: number | null;
};

export default function CreatorGrowthHub() {
  useSEO({ noindex: true, title: 'Creator Growth & Monetization', url: '/monetization' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [followers, setFollowers] = useState(0);
  const [eligible, setEligible] = useState(false);
  const [programEnabled, setProgramEnabled] = useState(false);
  const [availableCents, setAvailableCents] = useState(0);
  const [pendingCents, setPendingCents] = useState(0);
  const [lifetimeCents, setLifetimeCents] = useState(0);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [followRes, programRes, accountRes, postsRes] = await Promise.all([
        supabase.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', user!.id),
        supabase.from('creator_programs').select('enabled,eligible,follower_requirement').eq('user_id', user!.id).maybeSingle(),
        supabase.from('monetization_accounts').select('available_cents,pending_cents,lifetime_earned_cents').eq('user_id', user!.id).maybeSingle(),
        supabase.from('posts').select('id,content,image_url,video_url,is_video,views_count').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(12),
      ]);

      if (cancelled) return;
      const count = Number(followRes.count ?? 0);
      setFollowers(count);
      setEligible(count >= FOLLOWER_REQUIREMENT);
      setProgramEnabled(Boolean(programRes.data?.enabled));
      setAvailableCents(Number(accountRes.data?.available_cents ?? 0));
      setPendingCents(Number(accountRes.data?.pending_cents ?? 0));
      setLifetimeCents(Number(accountRes.data?.lifetime_earned_cents ?? 0));
      setPosts((postsRes.data ?? []) as Post[]);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [user, navigate]);

  const followerProgress = Math.min(100, Math.round((followers / FOLLOWER_REQUIREMENT) * 100));
  const followersNeeded = Math.max(0, FOLLOWER_REQUIREMENT - followers);
  const videoCount = useMemo(() => posts.filter((post) => post.is_video && post.video_url).length, [posts]);

  const enableCreatorMonetization = async () => {
    if (!user || !eligible) return;
    setEnabling(true);
    try {
      const { error } = await supabase.from('creator_programs').upsert({
        user_id: user.id,
        enabled: true,
        eligible: true,
        follower_requirement: FOLLOWER_REQUIREMENT,
        eligibility_checked_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
      setProgramEnabled(true);
      toast.success('Creator monetization is now enabled.');
    } catch (error: any) {
      toast.error(error?.message || 'Could not enable creator monetization');
    } finally {
      setEnabling(false);
    }
  };

  const boostPost = (postId: string) => navigate(`/boost-create?post_id=${encodeURIComponent(postId)}`);
  const createAd = () => navigate('/create-ad');

  if (!user || loading) {
    return <div className="min-h-screen bg-background"><TopBar title="Creator Growth" showBack /><div className="p-8 text-center text-muted-foreground">Loading creator tools…</div></div>;
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <TopBar title="Creator Growth & Monetization" showBack />
      <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-5">
        <section className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-purple-500/5 to-transparent p-5 md:p-7">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0"><Sparkles className="h-6 w-6 text-primary" /></div>
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-widest text-primary">Creator control center</p>
              <h1 className="text-2xl md:text-3xl font-black mt-1">Grow, advertise, boost & earn</h1>
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl">Promote your best posts, build campaigns for your business, and turn qualifying video and content activity into creator revenue.</p>
            </div>
          </div>
        </section>

        <section className={`rounded-2xl border p-4 md:p-5 ${eligible ? 'border-green-500/30 bg-green-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
          <div className="flex items-start gap-3">
            {eligible ? <CheckCircle2 className="h-6 w-6 text-green-600 mt-0.5" /> : <Users className="h-6 w-6 text-amber-600 mt-0.5" />}
            <div className="flex-1">
              <div className="flex flex-wrap gap-2 items-center justify-between">
                <div>
                  <h2 className="font-black">Creator monetization eligibility</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">You need at least {FOLLOWER_REQUIREMENT} followers to earn from the creator revenue program.</p>
                </div>
                <span className={`text-xs font-black px-2.5 py-1 rounded-full ${eligible ? 'bg-green-500/15 text-green-700' : 'bg-amber-500/15 text-amber-700'}`}>{eligible ? 'Eligible' : `${followersNeeded} more needed`}</span>
              </div>
              <div className="mt-4 h-2 rounded-full bg-background/70 overflow-hidden"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${followerProgress}%` }} /></div>
              <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{followers.toLocaleString()} followers</span><span>{FOLLOWER_REQUIREMENT.toLocaleString()} required</span></div>
              {eligible && !programEnabled && (
                <Button onClick={enableCreatorMonetization} disabled={enabling} className="mt-4 rounded-full">{enabling ? 'Enabling…' : 'Enable creator monetization'} <ChevronRight className="h-4 w-4 ml-1" /></Button>
              )}
              {eligible && programEnabled && <p className="mt-3 text-xs font-semibold text-green-700 flex items-center gap-1"><ShieldCheck className="h-4 w-4" /> Program active — qualifying revenue can be credited.</p>}
            </div>
          </div>
        </section>

        <section className="grid md:grid-cols-3 gap-3">
          <button onClick={() => posts[0] ? boostPost(posts[0].id) : navigate('/boost-create')} className="text-left rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
            <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center"><Rocket className="h-5 w-5 text-orange-500" /></div>
            <h3 className="font-black mt-3">Boost a post</h3>
            <p className="text-xs text-muted-foreground mt-1">Choose reach, engagement, conversions or video views, then set audience, budget and duration.</p>
            <span className="inline-flex items-center text-xs font-bold text-primary mt-3">Start boost <ChevronRight className="h-3.5 w-3.5" /></span>
          </button>
          <button onClick={createAd} className="text-left rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><Megaphone className="h-5 w-5 text-blue-500" /></div>
            <h3 className="font-black mt-3">Create your own ad</h3>
            <p className="text-xs text-muted-foreground mt-1">Build image or story campaigns, choose a budget and audience, then pay securely with M-Pesa.</p>
            <span className="inline-flex items-center text-xs font-bold text-primary mt-3">Create ad <ChevronRight className="h-3.5 w-3.5" /></span>
          </button>
          <button onClick={() => navigate('/wallet')} className="text-left rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
            <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center"><Wallet className="h-5 w-5 text-green-500" /></div>
            <h3 className="font-black mt-3">Earnings & payouts</h3>
            <p className="text-xs text-muted-foreground mt-1">Track available, pending and lifetime creator earnings and move eligible balances to payout.</p>
            <span className="inline-flex items-center text-xs font-bold text-primary mt-3">Open wallet <ChevronRight className="h-3.5 w-3.5" /></span>
          </button>
        </section>

        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-5 border-b border-border flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-primary" />
            <div className="flex-1"><h2 className="font-black">Creator revenue snapshot</h2><p className="text-xs text-muted-foreground">Video and content revenue is protected by the 400-follower eligibility rule.</p></div>
            {programEnabled && <span className="text-xs font-bold text-green-600">Active</span>}
          </div>
          <div className="grid grid-cols-3 divide-x divide-border">
            <div className="p-4 text-center"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Available</p><p className="font-black text-green-600 mt-1">${(availableCents / 100).toFixed(2)}</p></div>
            <div className="p-4 text-center"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending</p><p className="font-black mt-1">${(pendingCents / 100).toFixed(2)}</p></div>
            <div className="p-4 text-center"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Lifetime</p><p className="font-black mt-1">${(lifetimeCents / 100).toFixed(2)}</p></div>
          </div>
          <div className="p-5 grid md:grid-cols-2 gap-3">
            <div className="rounded-xl bg-muted/40 p-4"><div className="flex items-center gap-2"><Play className="h-4 w-4 text-red-500" /><p className="font-bold text-sm">Video monetization</p></div><p className="text-xs text-muted-foreground mt-1">Qualifying video views can generate ad-revenue share after you meet the 400-follower requirement.</p><div className="mt-3 flex items-center gap-2 text-xs"><span className="font-bold">{videoCount}</span><span className="text-muted-foreground">videos in your latest posts</span></div></div>
            <div className="rounded-xl bg-muted/40 p-4"><div className="flex items-center gap-2"><Target className="h-4 w-4 text-purple-500" /><p className="font-bold text-sm">Content monetization</p></div><p className="text-xs text-muted-foreground mt-1">Paid content, sponsorships, digital products and other supported creator revenue use the same eligibility gate.</p><button onClick={() => navigate('/monetization')} className="mt-3 text-xs font-bold text-primary">Open creator tools →</button></div>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3"><div><h2 className="font-black">Promote your content</h2><p className="text-xs text-muted-foreground">Every post can become a targeted paid campaign.</p></div><button onClick={() => navigate('/boost-create')} className="text-xs font-bold text-primary">Advanced boost →</button></div>
          <div className="space-y-2">
            {posts.slice(0, 6).map((post) => (
              <div key={post.id} className="rounded-2xl border border-border bg-card p-3 flex items-center gap-3">
                <div className="h-14 w-14 rounded-xl bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                  {post.video_url && post.is_video ? <video src={post.video_url} muted playsInline className="h-full w-full object-cover" /> : post.image_url ? <img src={post.image_url} alt="" className="h-full w-full object-cover" /> : <Eye className="h-5 w-5 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0"><p className="text-sm font-semibold line-clamp-2">{post.content?.trim() || (post.is_video ? 'Video post' : 'Post')}</p><p className="text-[11px] text-muted-foreground mt-1">{Number(post.views_count ?? 0).toLocaleString()} views</p></div>
                <Button variant="outline" size="sm" onClick={() => boostPost(post.id)} className="rounded-full shrink-0"><Rocket className="h-3.5 w-3.5 mr-1" />Boost</Button>
              </div>
            ))}
            {posts.length === 0 && <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Create your first post, then return here to promote it.</div>}
          </div>
        </section>

        <section className="rounded-2xl border border-border p-4 flex items-start gap-3 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p><strong className="text-foreground">Fairness & safety:</strong> boosting and advertising are paid promotion tools and are not the same as creator revenue. Creator monetization is only activated at {FOLLOWER_REQUIREMENT}+ followers and the backend re-checks eligibility before revenue is credited.</p>
        </section>
      </main>
    </div>
  );
}
