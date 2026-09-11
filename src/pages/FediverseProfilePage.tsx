import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Globe, Heart, Loader2, MessageCircle, Repeat2, UserPlus, UserMinus } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import * as federation from '@/api/federation';
import { toast } from 'sonner';

function actorUrlOf(actor: any): string {
  return String(actor?.id ?? actor?.url ?? actor?.actor_url ?? '').trim();
}

function actorDomain(actor: any, fallback = ''): string {
  try { return new URL(actorUrlOf(actor)).hostname; } catch { return fallback; }
}

function actorHandle(actor: any, fallbackDomain = ''): string {
  const username = actor?.preferredUsername ?? actor?.username ?? actor?.acct?.split('@')[0] ?? 'unknown';
  const domain = actorDomain(actor, fallbackDomain);
  return domain ? `@${username}@${domain}` : `@${username}`;
}

export default function FediverseProfilePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [actor, setActor] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [states, setStates] = useState<Record<string, { liked?: boolean; boosted?: boolean }>>({});

  const actorTarget = useMemo(() => new URLSearchParams(location.search).get('actor') ?? '', [location.search]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!actorTarget) { setLoading(false); return; }
      setLoading(true);
      try {
        const resolved = await federation.getUser(actorTarget);
        const remote = resolved?.actor ?? resolved;
        if (!alive) return;
        setActor(remote);
        const canonical = actorUrlOf(remote) || actorTarget;
        const { data } = await supabase.from('remote_posts').select('*').eq('actor_url', canonical).order('published_at', { ascending: false }).limit(30);
        if (alive) setPosts(data ?? []);
      } catch (error: any) {
        if (alive) toast.error(error?.message ?? 'Unable to load remote profile');
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [actorTarget]);

  const canonicalActor = actorUrlOf(actor) || actorTarget;
  const domain = actorDomain(actor, actorTarget.includes('@') ? actorTarget.split('@').pop() : '');
  const username = actor?.preferredUsername ?? actor?.username ?? actorTarget.replace(/^@/, '').split('@')[0] ?? 'unknown';
  const displayName = actor?.name ?? actor?.display_name ?? username;
  const avatar = actor?.icon?.url ?? actor?.icon?.href ?? actor?.avatar_url ?? actor?.avatar;
  const bio = actor?.summary ?? actor?.bio ?? '';

  const ensureAuth = () => { if (!user) { navigate('/auth'); return false; } return true; };
  const follow = async () => {
    if (!ensureAuth() || !canonicalActor) return;
    setBusy(true);
    try { await federation.follow(canonicalActor); setFollowing(true); toast.success('Follow request sent'); }
    catch (e: any) { toast.error(e?.message ?? 'Follow failed'); }
    finally { setBusy(false); }
  };
  const interact = async (post: any, kind: 'like' | 'repost') => {
    if (!ensureAuth()) return;
    const id = post.object_url ?? post.uri ?? post.url ?? post.id;
    if (!id) return;
    const current = states[id] ?? {};
    setStates(s => ({ ...s, [id]: { ...current, [kind === 'like' ? 'liked' : 'boosted']: !current[kind === 'like' ? 'liked' : 'boosted'] } }));
    try {
      if (kind === 'like') current.liked ? await federation.unfavorite(id) : await federation.favorite(id);
      else current.boosted ? await federation.unboost(id) : await federation.boost(id);
    } catch (e: any) { setStates(s => ({ ...s, [id]: current })); toast.error(e?.message ?? `${kind} failed`); }
  };
  const reply = async (post: any) => {
    if (!ensureAuth()) return;
    const id = post.object_url ?? post.uri ?? post.url ?? post.id;
    if (!id || !replyText.trim()) return;
    setBusy(true);
    try { await federation.reply({ postId: id, content: replyText.trim() }); toast.success('Reply sent to the Fediverse'); setReplyText(''); setReplyFor(null); }
    catch (e: any) { toast.error(e?.message ?? 'Reply failed'); }
    finally { setBusy(false); }
  };

  return <div className="min-h-screen bg-background">
    <TopBar title="Fediverse profile" showBack />
    <div className="p-4 border-b border-border">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"><ArrowLeft className="w-4 h-4" />Back</button>
      {loading ? <div className="py-12 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div> : <>
        <div className="flex items-start gap-4">
          <div className="w-20 h-20 rounded-full bg-muted overflow-hidden shrink-0">{avatar ? <img src={avatar} alt={displayName} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-2xl font-bold">{String(displayName)[0]?.toUpperCase()}</div>}</div>
          <div className="min-w-0 flex-1"><h1 className="text-xl font-bold truncate">{displayName}</h1><p className="text-sm text-muted-foreground truncate">{actorHandle(actor, domain)}</p><p className="text-xs text-purple-500 flex items-center gap-1 mt-1"><Globe className="w-3 h-3" />{domain}</p></div>
          <button onClick={follow} disabled={busy || following} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60">{following ? <UserMinus className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}{following ? 'Requested' : 'Follow'}</button>
        </div>
        {bio && <div className="mt-4 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: bio }} />}
        {canonicalActor && <a href={canonicalActor} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink className="w-3 h-3" />Open canonical profile</a>}
      </>}
    </div>
    <div className="divide-y divide-border">{posts.map(post => { const id = post.object_url ?? post.uri ?? post.url ?? post.id; const st = states[id] ?? {}; return <article key={id} className="p-4"><div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-full bg-muted overflow-hidden">{avatar && <img src={avatar} alt="" className="w-full h-full object-cover" />}</div><div><div className="text-sm font-semibold">{displayName}</div><div className="text-xs text-muted-foreground">{actorHandle(actor, domain)}</div></div></div><div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: post.content ?? post.text ?? '' }} /><div className="mt-3 flex items-center gap-1"><button onClick={() => interact(post, 'like')} className={`px-3 py-1.5 rounded-full text-xs flex items-center gap-1 ${st.liked ? 'text-pink-600 bg-pink-500/10' : 'text-muted-foreground hover:bg-muted'}`}><Heart className="w-3.5 h-3.5" />{(post.likes_count ?? post.favourites_count ?? 0) + (st.liked ? 1 : 0)}</button><button onClick={() => interact(post, 'repost')} className={`px-3 py-1.5 rounded-full text-xs flex items-center gap-1 ${st.boosted ? 'text-green-600 bg-green-500/10' : 'text-muted-foreground hover:bg-muted'}`}><Repeat2 className="w-3.5 h-3.5" />{(post.boosts_count ?? post.reblogs_count ?? 0) + (st.boosted ? 1 : 0)}</button><button onClick={() => setReplyFor(replyFor === id ? null : id)} className="px-3 py-1.5 rounded-full text-xs flex items-center gap-1 text-muted-foreground hover:bg-muted"><MessageCircle className="w-3.5 h-3.5" />Reply</button></div>{replyFor === id && <div className="mt-2 flex gap-2"><textarea value={replyText} onChange={e => setReplyText(e.target.value)} className="flex-1 min-h-16 rounded-lg border border-border bg-muted/40 p-2 text-sm" placeholder="Reply to this post…" /><button disabled={busy || !replyText.trim()} onClick={() => reply(post)} className="px-3 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50">Send</button></div>}</article>; })}</div>
    {!loading && posts.length === 0 && <div className="p-10 text-center text-muted-foreground text-sm">No cached posts from this profile yet. Open the canonical profile to view the full remote timeline.</div>}
  </div>;
}
