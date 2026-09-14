import { useEffect, useMemo, useState } from 'react';
import { Bookmark, ChevronDown, ChevronUp, Globe, Heart, Languages, Loader2, MessageCircle, Quote, Repeat2, Send, Share2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import * as localFediverse from '@/api/federatedLocal';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';

type Props = { post: any; disableNavigation?: boolean };
const ORIGIN_LABEL = /^(open\s+(on|at)\s+origin|open\s+original|view\s+(on\s+)?origin|view\s+original|open\s+source)$/i;

function scrubOriginUi() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('a,button').forEach(node => {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (ORIGIN_LABEL.test(text)) {
      (node as HTMLElement).style.display = 'none';
      (node as HTMLAnchorElement).removeAttribute('href');
      (node as HTMLAnchorElement).removeAttribute('target');
    }
  });
}
function stripHtml(value: string): string {
  if (!value) return '';
  if (typeof DOMParser === 'undefined') return value.replace(/<[^>]+>/g, '');
  return new DOMParser().parseFromString(value, 'text/html').body.textContent ?? '';
}
function firstHttp(...values: unknown[]): string {
  return values.find(value => typeof value === 'string' && /^https?:\/\//i.test(value.trim())) as string || '';
}
function normalizedActor(post: any): any {
  const candidates = [post?.remote_accounts, post?.remote_account, post?.actor, post?.account, post?.author, post?.raw_object?.attributedTo, post].filter(Boolean);
  return Object.assign({}, ...candidates.reverse(), ...candidates);
}
function canonicalIdentity(post: any): string {
  return firstHttp(
    post?.object_url,
    post?.canonical_url,
    post?.uri,
    post?.url,
    post?.object?.id,
    post?.object?.url,
    post?.raw_object?.id,
    post?.raw_object?.url,
  ) || String(post?.federated_object_id ?? post?._canonical_federated_object_id ?? post?.id ?? '').trim();
}

export function FederatedPostCard({ post, disableNavigation = false }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const actor = normalizedActor(post);
  const username = String(actor.preferredUsername ?? actor.username ?? actor.acct ?? post.actor_username ?? post.username ?? 'unknown').replace(/^@/, '');
  const actorUrl = firstHttp(actor.url, actor.id, actor.actor_url, post.actor_url, post.actor_uri);
  const domain = actorUrl ? (() => { try { return new URL(actorUrl).hostname; } catch { return ''; } })() : String(actor.domain ?? post.fediverse_domain ?? '');
  const displayHandle = username.includes('@') ? username : (domain ? `${username}@${domain}` : username);
  const actorTarget = actorUrl || (displayHandle !== 'unknown' ? displayHandle : '');
  const profileHref = actorTarget ? `/fediverse/profile?actor=${encodeURIComponent(actorTarget)}` : '';
  const objectIdentity = canonicalIdentity(post);
  const createdAt = post.created_at ?? post.published ?? post.published_at ?? post.object?.published ?? '';
  const rawText = stripHtml(post.content ?? post.text ?? post.object?.content ?? post.raw_object?.content ?? '');
  const media = useMemo(() => Array.isArray(post.media_attachments) ? post.media_attachments : (Array.isArray(post.attachments) ? post.attachments : (Array.isArray(post.object?.attachment) ? post.object.attachment : [])), [post.media_attachments, post.attachments, post.object?.attachment]);
  const [liked, setLiked] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [following, setFollowing] = useState(false);
  const [likes, setLikes] = useState(Number(post.favourites_count ?? post.likes_count ?? post.like_count ?? 0));
  const [reposts, setReposts] = useState(Number(post.reblogs_count ?? post.boosts_count ?? post.announce_count ?? 0));
  const [replies, setReplies] = useState(Number(post.replies_count ?? post.reply_count ?? 0));
  const [busy, setBusy] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const displayName = actor.name ?? actor.display_name ?? post.actor_name ?? username;

  useEffect(() => {
    scrubOriginUi();
    if (typeof document === 'undefined') return;
    const observer = new MutationObserver(scrubOriginUi);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a') as HTMLAnchorElement | null;
      if (!anchor || anchor.dataset.fediverseProfile === 'true' || anchor.target !== '_blank') return;
      let href: URL;
      try { href = new URL(anchor.href, window.location.origin); } catch { return; }
      if (href.origin === window.location.origin || !/^https?:$/.test(href.protocol)) return;
      event.preventDefault();
      event.stopPropagation();
      navigate(`/fediverse/post?url=${encodeURIComponent(href.toString())}`);
    };
    document.addEventListener('click', onClick, true);
    return () => { observer.disconnect(); document.removeEventListener('click', onClick, true); };
  }, [navigate]);

  useEffect(() => {
    if (!user || !objectIdentity) return;
    let active = true;
    (async () => {
      try {
        const [like, repost, bookmark, follow] = await Promise.all([
          localFediverse.hasLocalInteraction(user.id, objectIdentity, 'like'),
          localFediverse.hasLocalInteraction(user.id, objectIdentity, 'repost'),
          localFediverse.hasLocalInteraction(user.id, objectIdentity, 'bookmark'),
          actorTarget ? localFediverse.isLocallyFollowing(user.id, actorTarget) : Promise.resolve(false),
        ]);
        if (active) { setLiked(like); setReposted(repost); setBookmarked(bookmark); setFollowing(follow); }
      } catch {}
    })();
    return () => { active = false; };
  }, [user?.id, objectIdentity, actorTarget]);

  const run = async (key: string, fn: () => Promise<void>) => {
    if (!user) { navigate('/auth'); return; }
    if (busy) return;
    setBusy(key); setErrorMessage('');
    try { await fn(); } catch (error) { const message = error instanceof Error ? error.message : 'The local action could not be completed.'; setErrorMessage(message); toast.error(message); } finally { setBusy(''); }
  };
  const toggleLocal = (type: 'like' | 'repost' | 'bookmark', value: boolean, setValue: (v: boolean) => void, setCount?: (fn: (v: number) => number) => void) => run(type, async () => { if (!objectIdentity) throw new Error('This Fediverse post has no local identity.'); await localFediverse.setLocalInteraction(user?.id, objectIdentity, type, !value); setValue(!value); if (setCount) setCount(v => Math.max(0, v + (value ? -1 : 1))); });
  const toggleFollow = () => run('follow', async () => { if (!actorTarget) throw new Error('This Fediverse profile has no local identity.'); await localFediverse.setLocalFollow(user?.id, actorTarget, displayHandle, !following); setFollowing(!following); });
  const submitReply = () => run('reply', async () => { if (!objectIdentity) throw new Error('This Fediverse post has no local identity.'); const content = replyText.trim(); if (!content) return; await localFediverse.createLocalInteraction(user?.id, objectIdentity, 'reply', content); setReplyText(''); setReplyOpen(false); setReplies(v => v + 1); });
  const quote = () => run('quote', async () => { if (!objectIdentity) throw new Error('This Fediverse post has no local identity.'); const content = window.prompt('Add a comment to your quote (optional):', '') ?? ''; await localFediverse.createLocalInteraction(user?.id, objectIdentity, 'quote', content.trim()); });
  const share = async () => { if (!objectIdentity) return; const url = `${window.location.origin}/fediverse/post?url=${encodeURIComponent(objectIdentity)}`; try { if (navigator.share) await navigator.share({ title: displayName, text: rawText.slice(0, 180), url }); else { await navigator.clipboard.writeText(url); toast.success('Testagram link copied'); } } catch {} };
  const translate = async () => { if (translation) { setTranslation(null); return; } if (!rawText) return; setTranslating(true); try { const { data, error } = await supabase.functions.invoke('ai-chat', { body: { messages: [{ role: 'user', content: `Translate this Fediverse post to English. Return only the translation:\n\n${rawText}` }], model: 'gemini-2.0-flash' } }); if (error) throw error; setTranslation(String(data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? data?.response ?? '').trim()); } catch { setTranslation('Translation failed.'); } finally { setTranslating(false); } };
  const openDetail = () => { if (!disableNavigation && objectIdentity) navigate(`/fediverse/post?url=${encodeURIComponent(objectIdentity)}`, { state: { post } }); };
  const openProfile = (event: any) => { event.preventDefault(); event.stopPropagation(); if (profileHref) navigate(profileHref); };
  const onContentKeyDown = (event: React.KeyboardEvent) => { if ((event.key === 'Enter' || event.key === ' ') && !disableNavigation) { event.preventDefault(); openDetail(); } };

  return <article className="border-b border-border p-4 hover:bg-muted/5 transition-colors"><div className="flex gap-3"><a href={profileHref || '#'} onClick={openProfile} data-fediverse-profile="true" className="w-10 h-10 rounded-full bg-muted overflow-hidden flex-shrink-0" aria-label={`Open ${displayHandle}`}><span className="sr-only">Open profile</span>{firstHttp(actor.icon?.url, actor.icon?.href, actor.avatar, actor.avatar_url, post.avatar_url) ? <img src={firstHttp(actor.icon?.url, actor.icon?.href, actor.avatar, actor.avatar_url, post.avatar_url)} alt="" className="w-full h-full object-cover" /> : <span className="w-full h-full flex items-center justify-center font-bold">{username[0]?.toUpperCase()}</span>}</a><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><a href={profileHref || '#'} onClick={openProfile} data-fediverse-profile="true" className="font-semibold text-sm truncate hover:underline">{displayName}</a><span className="text-xs text-purple-500 flex items-center gap-1"><Globe className="w-3 h-3" />Fediverse</span>{createdAt && <span className="text-xs text-muted-foreground">· {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}</span>}</div><div className="flex items-center gap-2 mt-0.5"><a href={profileHref || '#'} onClick={openProfile} data-fediverse-profile="true" className="text-xs text-muted-foreground truncate hover:underline">@{displayHandle}</a>{user && actorTarget && <button onClick={toggleFollow} disabled={Boolean(busy)} aria-pressed={following} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${following ? 'border-border text-muted-foreground' : 'border-primary text-primary'}`}>{busy === 'follow' ? '…' : following ? 'Following' : 'Follow'}</button>}</div><div role="button" tabIndex={disableNavigation ? -1 : 0} onClick={openDetail} onKeyDown={onContentKeyDown} className={`${disableNavigation ? '' : 'cursor-pointer'} rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30`}><div className={`text-sm leading-relaxed mt-2 whitespace-pre-wrap break-words ${showMore ? '' : 'line-clamp-12'}`}>{rawText}</div>{rawText.length > 800 && <button onClick={e => { e.stopPropagation(); setShowMore(v => !v); }} className="text-xs text-primary mt-1 flex items-center gap-1">{showMore ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}{showMore ? 'Show less' : 'Show more'}</button>}{media.length > 0 && <div className={`mt-3 grid gap-1 rounded-xl overflow-hidden ${media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>{media.slice(0, 4).map((m: any, i: number) => m.type === 'image' ? <img key={i} src={m.url ?? m.preview_url} alt={m.description ?? ''} className="w-full max-h-80 object-cover" loading="lazy" /> : m.url ? <video key={i} src={m.url} controls onClick={e => e.stopPropagation()} className="w-full max-h-80 bg-black" /> : null)}</div>}</div>{translation && <div className="mt-2 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-sm">{translation}</div>}{errorMessage && <div role="status" className="mt-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{errorMessage}</div>}<div className="flex items-center justify-between mt-3 max-w-xl text-muted-foreground" onClick={e => e.stopPropagation()}><button onClick={() => setReplyOpen(v => !v)} disabled={Boolean(busy)} aria-label="Reply" className="flex items-center gap-1.5 hover:text-primary"><MessageCircle className="w-4 h-4" /><span>{formatNumber(replies)}</span></button><button onClick={() => toggleLocal('repost', reposted, setReposted, setReposts)} disabled={Boolean(busy)} aria-pressed={reposted} className={`flex items-center gap-1.5 hover:text-green-500 ${reposted ? 'text-green-500' : ''}`}><Repeat2 className="w-4 h-4" /><span>{formatNumber(reposts)}</span></button><button onClick={() => toggleLocal('like', liked, setLiked, setLikes)} disabled={Boolean(busy)} aria-pressed={liked} className={`flex items-center gap-1.5 hover:text-pink-500 ${liked ? 'text-pink-500' : ''}`}><Heart className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} /><span>{formatNumber(likes)}</span></button><button onClick={quote} disabled={Boolean(busy)} title="Quote" aria-label="Quote"><Quote className="w-4 h-4" /></button><button onClick={() => toggleLocal('bookmark', bookmarked, setBookmarked)} disabled={Boolean(busy)} title={bookmarked ? 'Remove bookmark' : 'Bookmark'} aria-pressed={bookmarked}><Bookmark className="w-4 h-4" fill={bookmarked ? 'currentColor' : 'none'} /></button><button onClick={share} title="Share" aria-label="Share"><Share2 className="w-4 h-4" /></button><button onClick={translate} disabled={translating || Boolean(busy)} title="Translate" aria-label="Translate">{translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}</button></div>{replyOpen && <div className="mt-3 flex items-center gap-2"><input value={replyText} onChange={e => setReplyText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitReply(); }} placeholder="Reply / comment…" className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" maxLength={1000} /><button onClick={submitReply} disabled={!replyText.trim() || Boolean(busy)} className="p-2 rounded-full bg-primary text-primary-foreground disabled:opacity-40">{busy === 'reply' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</button></div>}</div></div></article>;
}
