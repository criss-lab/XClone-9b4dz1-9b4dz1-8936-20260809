import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bookmark, Globe, Heart, Loader2, MessageCircle, Quote, Repeat2, Send, Share2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import * as federation from '@/api/federation';
import * as localFediverse from '@/api/federatedLocal';
import { formatNumber } from '@/lib/utils';

type Props = { post: any; compact?: boolean; disableNavigation?: boolean };

const http = (...values: unknown[]) => values.find(v => typeof v === 'string' && /^https?:\/\//i.test(v.trim())) as string || '';
const actorOf = (post: any) => {
  const candidates = [post?.remote_accounts, post?.remote_account, post?.actor, post?.account, post?.author, post?.raw_object?.attributedTo, post];
  return Object.assign({}, ...candidates.filter(Boolean).reverse(), ...candidates.filter(Boolean));
};
const identityOf = (post: any) => http(post?.object_url, post?.canonical_url, post?.uri, post?.url, post?.object?.id, post?.raw_object?.id) || String(post?.id ?? '').trim();
const textOf = (post: any) => post?.content ?? post?.text ?? post?.object?.content ?? post?.raw_object?.content ?? '';
const strip = (html: string) => typeof DOMParser === 'undefined' ? html.replace(/<[^>]+>/g, '') : new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';

export function InteractiveFederatedPostCard({ post, compact = false, disableNavigation = false }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const actor = actorOf(post);
  const actorUrl = http(actor.id, actor.url, actor.actor_url, post.actor_url, post.actor_uri);
  const username = String(actor.preferredUsername ?? actor.username ?? actor.acct ?? post.actor_username ?? post.username ?? 'unknown').replace(/^@/, '');
  const domain = actorUrl ? (() => { try { return new URL(actorUrl).hostname; } catch { return ''; } })() : String(actor.domain ?? post.domain ?? '');
  const handle = username.includes('@') ? username : domain ? `${username}@${domain}` : username;
  const actorTarget = actorUrl || (handle !== 'unknown' ? handle : '');
  const profileHref = actorTarget ? `/fediverse/profile?actor=${encodeURIComponent(actorTarget)}` : '';
  const objectUrl = identityOf(post);
  const rawContent = textOf(post);
  const plainContent = strip(rawContent);
  const created = post.created_at ?? post.published_at ?? post.published ?? post.object?.published ?? '';
  const avatar = http(actor.icon?.url, actor.icon?.href, actor.avatar_url, actor.avatar, post.avatar_url);
  const media = useMemo(() => Array.isArray(post.media_attachments) ? post.media_attachments : Array.isArray(post.attachments) ? post.attachments : Array.isArray(post.object?.attachment) ? post.object.attachment : [], [post]);
  const [liked, setLiked] = useState(false);
  const [boosted, setBoosted] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [following, setFollowing] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState('');
  const [likes, setLikes] = useState(Number(post.likes_count ?? post.favourites_count ?? post.like_count ?? 0));
  const [boosts, setBoosts] = useState(Number(post.boosts_count ?? post.reblogs_count ?? 0));
  const [replies, setReplies] = useState(Number(post.replies_count ?? post.reply_count ?? 0));

  useEffect(() => {
    if (!user || !objectUrl) return;
    let active = true;
    Promise.all([
      localFediverse.hasLocalInteraction(user.id, objectUrl, 'like'),
      localFediverse.hasLocalInteraction(user.id, objectUrl, 'repost'),
      localFediverse.hasLocalInteraction(user.id, objectUrl, 'bookmark'),
      actorTarget ? localFediverse.isLocallyFollowing(user.id, actorTarget) : Promise.resolve(false),
    ]).then(([l, b, bm, f]) => { if (active) { setLiked(l); setBoosted(b); setBookmarked(bm); setFollowing(f); } }).catch(() => {});
    return () => { active = false; };
  }, [user?.id, objectUrl, actorTarget]);

  const auth = () => { if (!user) { navigate('/auth'); return false; } return true; };
  const run = async (name: string, fn: () => Promise<void>) => {
    if (!auth() || busy) return;
    setBusy(name);
    try { await fn(); } catch (e: any) { toast.error(e?.message ?? `${name} failed`); } finally { setBusy(''); }
  };
  const openPost = () => { if (!disableNavigation && objectUrl) navigate(`/fediverse/post?url=${encodeURIComponent(objectUrl)}`, { state: { post } }); };

  const toggleLike = () => run('like', async () => {
    const next = !liked;
    if (next) await federation.favorite(objectUrl); else await federation.unfavorite(objectUrl);
    setLiked(next); setLikes(v => Math.max(0, v + (next ? 1 : -1)));
  });
  const toggleBoost = () => run('boost', async () => {
    const next = !boosted;
    if (next) await federation.boost(objectUrl); else await federation.unboost(objectUrl);
    setBoosted(next); setBoosts(v => Math.max(0, v + (next ? 1 : -1)));
  });
  const toggleBookmark = () => run('bookmark', async () => {
    const next = !bookmarked;
    if (next) await federation.bookmark(objectUrl); else await federation.unbookmark(objectUrl);
    setBookmarked(next);
  });
  const toggleFollow = () => run('follow', async () => {
    const next = !following;
    if (next) await federation.follow(actorTarget); else await federation.unfollow(actorTarget);
    await localFediverse.setLocalFollow(user!.id, actorTarget, handle, next);
    setFollowing(next);
  });
  const submitReply = () => run('reply', async () => {
    const value = reply.trim(); if (!value) return;
    await federation.reply({ postId: objectUrl, content: value });
    setReply(''); setReplyOpen(false); setReplies(v => v + 1);
  });
  const quote = () => run('quote', async () => {
    const value = window.prompt('Add a comment to your quote (optional):', '') ?? '';
    await federation.quote({ postId: objectUrl, content: value.trim() });
  });
  const share = async () => {
    const url = `${window.location.origin}/fediverse/post?url=${encodeURIComponent(objectUrl)}`;
    try { if (navigator.share) await navigator.share({ title: actor.name ?? username, text: plainContent.slice(0, 180), url }); else { await navigator.clipboard.writeText(url); toast.success('Testagram Fediverse link copied'); } } catch {}
  };

  const profileLink = profileHref || '/fediverse';

  return <article className={`${compact ? 'p-3' : 'p-4'} border-b border-border hover:bg-muted/5 transition-colors`}>
    <div className="flex gap-3">
      <Link to={profileLink} className="shrink-0" aria-label={`Open @${handle} profile`}>
        <div className={`${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-full bg-muted overflow-hidden`}>
          {avatar ? <img src={avatar} alt={username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-xs">{username[0]?.toUpperCase()}</div>}
        </div>
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={profileLink} className="font-semibold text-sm hover:underline truncate">{actor.display_name ?? actor.name ?? username}</Link>
          <Link to={profileLink} className="text-xs text-purple-500 hover:underline flex items-center gap-1"><Globe className="w-3 h-3" />@{handle}</Link>
          {created && <span className="text-xs text-muted-foreground">· {formatDistanceToNow(new Date(created), { addSuffix: true })}</span>}
        </div>
        <button type="button" onClick={openPost} disabled={disableNavigation} className={`block w-full text-left mt-2 ${disableNavigation ? '' : 'cursor-pointer'}`}>
          <div className={`${compact ? 'text-xs' : 'text-sm'} leading-relaxed break-words line-clamp-8`} dangerouslySetInnerHTML={{ __html: rawContent }} />
          {media.length > 0 && <div className={`mt-3 grid gap-1 rounded-xl overflow-hidden ${media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {media.slice(0, 4).map((m: any, i: number) => m.type === 'video' ? <video key={i} src={m.url ?? m.preview_url} controls onClick={e => e.stopPropagation()} className="w-full max-h-80 bg-black" /> : <img key={i} src={m.url ?? m.preview_url} alt={m.description ?? ''} className="w-full max-h-80 object-cover" loading="lazy" />)}
          </div>}
        </button>
        <div className="flex items-center justify-between mt-3 max-w-xl text-muted-foreground" onClick={e => e.stopPropagation()}>
          <button onClick={() => setReplyOpen(v => !v)} disabled={!!busy} className="flex items-center gap-1.5 hover:text-primary"><MessageCircle className="w-4 h-4" /><span>{formatNumber(replies)}</span></button>
          <button onClick={toggleBoost} disabled={!!busy} aria-pressed={boosted} className={`flex items-center gap-1.5 hover:text-green-500 ${boosted ? 'text-green-500' : ''}`}><Repeat2 className="w-4 h-4" /><span>{formatNumber(boosts)}</span></button>
          <button onClick={toggleLike} disabled={!!busy} aria-pressed={liked} className={`flex items-center gap-1.5 hover:text-pink-500 ${liked ? 'text-pink-500' : ''}`}><Heart className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} /><span>{formatNumber(likes)}</span></button>
          <button onClick={quote} disabled={!!busy} title="Quote" aria-label="Quote"><Quote className="w-4 h-4" /></button>
          <button onClick={toggleBookmark} disabled={!!busy} title={bookmarked ? 'Remove bookmark' : 'Bookmark'} aria-pressed={bookmarked}><Bookmark className="w-4 h-4" fill={bookmarked ? 'currentColor' : 'none'} /></button>
          <button onClick={share} title="Share" aria-label="Share"><Share2 className="w-4 h-4" /></button>
          {user && actorTarget && <button onClick={toggleFollow} disabled={!!busy} className="text-[11px] font-semibold px-2 py-1 rounded-full border border-primary text-primary">{busy === 'follow' ? <Loader2 className="w-3 h-3 animate-spin" /> : following ? 'Following' : 'Follow'}</button>}
        </div>
        {replyOpen && <div className="mt-3 flex gap-2">
          <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitReply(); }} placeholder={`Reply to @${handle}…`} className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" maxLength={1000} />
          <button onClick={submitReply} disabled={!reply.trim() || !!busy} className="p-2 rounded-full bg-primary text-primary-foreground disabled:opacity-40">{busy === 'reply' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</button>
        </div>}
        {busy && busy !== 'follow' && <div className="mt-1 text-[10px] text-muted-foreground">Sending to the Fediverse…</div>}
      </div>
    </div>
  </article>;
}
