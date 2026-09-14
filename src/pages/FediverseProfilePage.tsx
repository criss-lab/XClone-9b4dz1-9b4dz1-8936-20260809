import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Globe, Loader2, UserPlus, UserMinus, Users, Rss } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import * as federation from '@/api/federation';
import * as localFediverse from '@/api/federatedLocal';
import { InteractiveFederatedPostCard } from '@/components/features/InteractiveFederatedPostCard';
import { toast } from 'sonner';

function firstHttp(...values: unknown[]): string { return values.find(v => typeof v === 'string' && /^https?:\/\//i.test(v.trim())) as string || ''; }
function actorUrlOf(actor: any): string { return firstHttp(actor?.url, actor?.id, actor?.actor_url, actor?.uri); }
function actorDomain(actor: any, fallback = '') { try { return new URL(actorUrlOf(actor)).hostname; } catch { return fallback; } }
function actorHandle(actor: any, fallbackDomain = '') { const acct = String(actor?.acct ?? actor?.preferredUsername ?? actor?.username ?? 'unknown').replace(/^@/, ''); if (acct.includes('@')) return acct; const domain = actorDomain(actor, fallbackDomain); return domain ? `${acct}@${domain}` : acct; }
function mergeActor(value: any, fallback: string): any {
  const c = [value?.actor, value?.account, value?.data, value?.profile, value?.remote_accounts, value?.remote_account, value?.author, value?.raw_object?.attributedTo, value].filter(Boolean);
  const merged = Object.assign({}, ...c.reverse(), ...c);
  if (!merged.id && !merged.url && !merged.actor_url && !merged.uri) merged.id = fallback;
  return merged;
}

export default function FediverseProfilePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [actor, setActor] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [followers, setFollowers] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);

  const actorTarget = useMemo(() => new URLSearchParams(location.search).get('actor')?.trim() ?? '', [location.search]);
  const canonicalActor = actorUrlOf(actor) || (firstHttp(actorTarget) ? actorTarget : '');
  const domain = actorDomain(actor, actorTarget.includes('@') ? actorTarget.split('@').pop() || '' : '');
  const username = actor?.preferredUsername ?? actor?.username ?? actorTarget.replace(/^@/, '').split('@')[0] ?? 'unknown';
  const displayName = actor?.name ?? actor?.display_name ?? username;
  const avatar = firstHttp(actor?.icon?.url, actor?.icon?.href, actor?.avatar_url, actor?.avatar);
  const header = firstHttp(actor?.image?.url, actor?.image?.href, actor?.header, actor?.header_static);
  const bio = actor?.summary ?? actor?.bio ?? '';
  const handle = actorHandle(actor, domain);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!actorTarget) { setLoading(false); return; }
      setLoading(true);
      try {
        // Resolve both @user@domain and canonical actor URLs through Testagram's
        // federation gateway. The remote server is never used as the browser target.
        const resolved = await federation.getUser(actorTarget);
        const remote = mergeActor(resolved, actorTarget);
        if (!alive) return;
        setActor(remote);
        setFollowers(Number(remote.followers_count ?? remote.followers?.totalItems ?? 0) || null);
        setFollowingCount(Number(remote.following_count ?? remote.following?.totalItems ?? 0) || null);
        if (user) setFollowing(await localFediverse.isLocallyFollowing(user.id, actorUrlOf(remote) || actorTarget));
      } catch (e: any) {
        if (alive) toast.error(e?.message ?? 'Unable to resolve this Fediverse profile.');
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [actorTarget, user?.id]);

  useEffect(() => {
    if (!canonicalActor) return;
    let alive = true;
    (async () => {
      setLoadingPosts(true);
      try {
        const cached = await supabase.from('remote_posts').select('*, remote_accounts(*)').eq('actor_url', canonicalActor).order('published_at', { ascending: false }).limit(50);
        const cachedRows = cached.data ?? [];
        let fresh: any[] = [];
        try {
          const timeline = await federation.getFederatedTimeline({ limit: 50 });
          const items: any[] = Array.isArray(timeline) ? timeline : [];
          fresh = items.filter((item: any) => {
            const a = firstHttp(item?.actor?.id, item?.actor?.url, item?.actor_url, item?.actor_uri, item?.account?.url);
            return a === canonicalActor || a === actorTarget;
          });
        } catch {}
        const merged = [...fresh, ...cachedRows];
        const unique = [...new Map(merged.map(row => [String(row.object_url ?? row.uri ?? row.url ?? row.id), row])).values()]
          .sort((a, b) => Date.parse(String(b.published_at ?? b.created_at ?? b.published ?? 0)) - Date.parse(String(a.published_at ?? a.created_at ?? a.published ?? 0)))
          .slice(0, 50);
        if (alive) setPosts(unique);
      } finally { if (alive) setLoadingPosts(false); }
    })();
    return () => { alive = false; };
  }, [canonicalActor, actorTarget]);

  const toggleFollow = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!canonicalActor || busy) return;
    setBusy(true);
    const next = !following;
    try {
      if (next) await federation.follow(canonicalActor);
      else await federation.unfollow(canonicalActor);
      await localFediverse.setLocalFollow(user.id, canonicalActor, handle, next);
      setFollowing(next);
      toast.success(next ? 'Follow request sent to the remote instance.' : 'Unfollow request sent.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Unable to update the remote follow relationship.');
    } finally { setBusy(false); }
  };

  return <div className="min-h-screen bg-background pb-20">
    <TopBar title="Fediverse profile" showBack />
    {loading ? <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div> : <>
      <div className="border-b border-border">
        <div className="h-36 sm:h-48 bg-muted overflow-hidden">{header ? <img src={header} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gradient-to-r from-primary/20 via-purple-500/10 to-muted" />}</div>
        <div className="px-4 pb-4">
          <div className="flex items-end justify-between -mt-12 sm:-mt-14 gap-3">
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-muted border-4 border-background overflow-hidden shrink-0">{avatar ? <img src={avatar} alt={displayName} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-3xl font-bold">{String(displayName)[0]?.toUpperCase()}</div>}</div>
            <div className="flex items-center gap-2 pb-1">
              <button onClick={() => navigate(-1)} className="p-2 rounded-full border border-border bg-background hover:bg-muted" aria-label="Back"><ArrowLeft className="w-4 h-4" /></button>
              {canonicalActor && <button onClick={toggleFollow} disabled={busy} aria-pressed={following} className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold ${following ? 'border border-border bg-background' : 'bg-primary text-primary-foreground'}`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : following ? <UserMinus className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}{following ? 'Following' : 'Follow'}</button>}
            </div>
          </div>
          <div className="mt-3">
            <h1 className="text-xl font-bold">{displayName}</h1>
            <p className="text-sm text-muted-foreground">@{handle}</p>
            <p className="text-xs text-purple-500 flex items-center gap-1 mt-1"><Globe className="w-3 h-3" />{domain || 'remote Fediverse actor'}</p>
            {bio && <div className="mt-3 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: bio }} />}
            <div className="flex items-center gap-5 mt-4 text-sm"><span className="flex items-center gap-1.5"><Users className="w-4 h-4 text-muted-foreground" /><strong>{followers ?? '—'}</strong> followers</span><span className="flex items-center gap-1.5"><Rss className="w-4 h-4 text-muted-foreground" /><strong>{followingCount ?? '—'}</strong> following</span></div>
          </div>
        </div>
      </div>
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-semibold"><Rss className="w-4 h-4 text-purple-500" />Posts · {domain}</div>
      {loadingPosts ? <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div> : posts.length ? <div>{posts.map((post, index) => <InteractiveFederatedPostCard key={String(post.object_url ?? post.uri ?? post.url ?? post.id ?? index)} post={post} />)}</div> : <div className="p-12 text-center text-muted-foreground text-sm">No remote posts are cached for this profile yet. The profile is connected; new federated posts will appear as they are discovered.</div>}
    </>}
  </div>;
}
