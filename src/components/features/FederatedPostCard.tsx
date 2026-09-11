import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Globe, Heart, Languages, Loader2, MessageCircle, Quote, Repeat2, Send, Share2, Bookmark } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import * as federation from '@/api/federation';
import { supabase } from '@/lib/supabase';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';

type Props = { post: any; disableNavigation?: boolean };
function stripHtml(value: string): string { if (!value) return ''; return new DOMParser().parseFromString(value, 'text/html').body.textContent ?? ''; }

function interactionError(error: unknown): string {
  if (error instanceof federation.GatewayError) return error.body || error.message;
  if (error instanceof Error) return error.message;
  return 'The Fediverse action could not be completed.';
}

export function FederatedPostCard({ post, disableNavigation = false }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const actor = post.actor ?? post.account ?? {};
  const username = actor.preferredUsername ?? actor.username ?? actor.acct ?? 'unknown';
  const domain = actor.url ? (() => { try { return new URL(actor.url).hostname; } catch { return actor.domain ?? ''; } })() : (actor.domain ?? post.fediverse_domain ?? '');
  const acct = actor.acct ?? actor.preferredUsername ?? username;
  const handle = acct.includes('@') || !domain ? acct : `${acct}@${domain}`;
  const avatarUrl = actor.icon?.url ?? actor.avatar ?? actor.avatar_url;
  const displayName = actor.name ?? actor.display_name ?? username;
  const actorTarget = actor.url ?? actor.id ?? (handle !== 'unknown' ? handle : '');
  const profileHref = actorTarget ? `/fediverse/profile?actor=${encodeURIComponent(actorTarget)}` : '';


  const canonicalObjectUrl = post.object_url ?? post.uri ?? post.url ?? post.raw_object?.id ?? post.raw_object?.url ?? '';
  const createdAt = post.created_at ?? post.published ?? post.published_at ?? '';
  const rawText = stripHtml(post.content ?? post.text ?? '');
  const media = useMemo(() => Array.isArray(post.media_attachments) ? post.media_attachments : [], [post.media_attachments]);
  const [liked, setLiked] = useState(Boolean(post.favourited ?? post.liked));
  const [reposted, setReposted] = useState(Boolean(post.reblogged ?? post.boosted));
  const [bookmarked, setBookmarked] = useState(Boolean(post.bookmarked));
  const [following, setFollowing] = useState(Boolean(actor.following ?? post.following));
  const [likes, setLikes] = useState(Number(post.favourites_count ?? post.likes_count ?? 0));
  const [reposts, setReposts] = useState(Number(post.reblogs_count ?? post.boosts_count ?? 0));
  const [replies, setReplies] = useState(Number(post.replies_count ?? 0));
  const [busy, setBusy] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (!user) { navigate('/auth'); return; }
    if (busy) return;
    setBusy(key);
    setErrorMessage('');
    try {
      await fn();
    } catch (error) {
      const message = interactionError(error);
      setErrorMessage(message);
      toast.error(message);
      console.error(`[fediverse:${key}]`, error);
    } finally {
      setBusy('');
    }
  };
  const toggleLike = () => run('like', async () => { if (!canonicalObjectUrl) throw new Error('Fediverse post has no canonical object URL'); if (liked) { await federation.unfavorite(canonicalObjectUrl); setLiked(false); setLikes(v => Math.max(0, v - 1)); } else { await federation.favorite(canonicalObjectUrl); setLiked(true); setLikes(v => v + 1); } });
  const toggleRepost = () => run('repost', async () => { if (!canonicalObjectUrl) throw new Error('Fediverse post has no canonical object URL'); if (reposted) { await federation.unboost(canonicalObjectUrl); setReposted(false); setReposts(v => Math.max(0, v - 1)); } else { await federation.boost(canonicalObjectUrl); setReposted(true); setReposts(v => v + 1); } });
  const toggleBookmark = () => run('bookmark', async () => { if (!canonicalObjectUrl) throw new Error('Fediverse post has no canonical object URL'); if (bookmarked) { await federation.unbookmark(canonicalObjectUrl); setBookmarked(false); } else { await federation.bookmark(canonicalObjectUrl); setBookmarked(true); } });
  const toggleFollow = () => run('follow', async () => { if (!actorTarget) throw new Error('Fediverse actor has no canonical identity'); if (following) { await federation.unfollow(actorTarget); setFollowing(false); } else { await federation.follow(actorTarget); setFollowing(true); } });
  const submitReply = () => run('reply', async () => { const content = replyText.trim(); if (!content) return; if (!canonicalObjectUrl) throw new Error('Fediverse post has no canonical object URL'); await federation.reply({ postId: canonicalObjectUrl, content }); setReplyText(''); setReplyOpen(false); setReplies(v => v + 1); });
  const share = async () => { const url = canonicalObjectUrl || actorTarget; if (!url) { const message = 'This Fediverse item has no shareable identity.'; setErrorMessage(message); toast.error(message); return; } setErrorMessage(''); setBusy('share'); try { const testagramUrl = `${window.location.origin}/fediverse/post?url=${encodeURIComponent(url)}`; if (navigator.share) { try { await navigator.share({ title: displayName, text: rawText.slice(0, 180), url: testagramUrl }); return; } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; } } await navigator.clipboard.writeText(testagramUrl); toast.success('Testagram link copied'); } catch (error) { const message = interactionError(error); setErrorMessage(message); toast.error(message); console.error('[fediverse:share]', error); } finally { setBusy(''); } };
  const quote = () => run('quote', async () => { if (!canonicalObjectUrl) throw new Error('Fediverse post has no canonical object URL'); const text = window.prompt('Add a comment to your quote (optional):', ''); if (text === null) return; await federation.quote({ postId: canonicalObjectUrl, content: text.trim() }); });
  const translate = async () => { if (translation) { setTranslation(null); return; } if (!rawText) return; setTranslating(true); setErrorMessage(''); try { const { data, error } = await supabase.functions.invoke('ai-chat', { body: { messages: [{ role: 'user', content: `Translate this Fediverse post to English. Return only the translation:\n\n${rawText}` }], model: 'gemini-2.0-flash' } }); if (error) throw error; setTranslation(String(data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? data?.response ?? '').trim()); } catch (error) { const message = 'Translation failed.'; setTranslation(message); setErrorMessage(message); toast.error(message); console.error('[fediverse:translate]', error); } finally { setTranslating(false); } };

  // Federated object URLs are data identifiers only. They must never become browser navigation targets.
  // Post content is rendered as text (HTML stripped above), and every interactive action stays in Testagram.
  const openDetail = () => { if (disableNavigation || !canonicalObjectUrl) return; navigate(`/fediverse/post?url=${encodeURIComponent(canonicalObjectUrl)}`, { state: { post } }); };
  const handleDetailKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => { if (disableNavigation) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(); } };

  return <article className="border-b border-border p-4 hover:bg-muted/5 transition-colors">
    <div className="flex gap-3">
      <a href={profileHref || '#'} onClick={e => { if (!profileHref) e.preventDefault(); }} className="w-10 h-10 rounded-full bg-muted overflow-hidden flex-shrink-0" aria-label={`Open ${handle}`}> 
        {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" /> : <span className="w-full h-full flex items-center justify-center font-bold">{username[0]?.toUpperCase()}</span>}
      </a>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap"><a href={profileHref || '#'} onClick={e => { if (!profileHref) e.preventDefault(); }} className="font-semibold text-sm truncate hover:underline">{displayName}</a>{domain && <span className="text-xs text-purple-500 flex items-center gap-1"><Globe className="w-3 h-3" />{domain}</span>}{createdAt && <span className="text-xs text-muted-foreground">· {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}</span>}</div>
        <div className="flex items-center gap-2 mt-0.5"><a href={profileHref || '#'} onClick={e => { if (!profileHref) e.preventDefault(); }} className="text-xs text-muted-foreground truncate hover:underline">@{handle}</a>{user && <button onClick={toggleFollow} disabled={Boolean(busy)} aria-pressed={following} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${following ? 'border-border text-muted-foreground' : 'border-primary text-primary'}`}>{busy === 'follow' ? '…' : following ? 'Following' : 'Follow'}</button>}</div>
        <div role="button" tabIndex={disableNavigation ? -1 : 0} onClick={openDetail} onKeyDown={handleDetailKeyDown} className={`${disableNavigation ? '' : 'cursor-pointer'} rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30`} aria-label={disableNavigation ? undefined : 'Open Fediverse post in Testagram'}>
          <div className={`text-sm leading-relaxed mt-2 whitespace-pre-wrap break-words ${showMore ? '' : 'line-clamp-12'}`}>{rawText}</div>
          {rawText.length > 800 && <button onClick={e => { e.stopPropagation(); setShowMore(v => !v); }} className="text-xs text-primary mt-1 flex items-center gap-1">{showMore ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}{showMore ? 'Show less' : 'Show more'}</button>}
          {media.length > 0 && <div className={`mt-3 grid gap-1 rounded-xl overflow-hidden ${media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>{media.slice(0, 4).map((m: any, i: number) => m.type === 'image' ? <img key={i} src={m.url ?? m.preview_url} alt={m.description ?? ''} className="w-full max-h-80 object-cover" loading="lazy" /> : m.url ? <video key={i} src={m.url} controls onClick={e => e.stopPropagation()} className="w-full max-h-80 bg-black" /> : null)}</div>}
        </div>
        {translation && <div className="mt-2 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-sm">{translation}</div>}
        {errorMessage && <div role="status" className="mt-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{errorMessage}</div>}
        <div className="flex items-center justify-between mt-3 max-w-xl text-muted-foreground" onClick={e => e.stopPropagation()}>
          <button onClick={() => setReplyOpen(v => !v)} disabled={Boolean(busy)} aria-label="Reply" className="flex items-center gap-1.5 hover:text-primary"><MessageCircle className="w-4 h-4" /><span>{formatNumber(replies)}</span></button>
          <button onClick={toggleRepost} disabled={Boolean(busy)} aria-pressed={reposted} className={`flex items-center gap-1.5 hover:text-green-500 ${reposted ? 'text-green-500' : ''}`}><Repeat2 className="w-4 h-4" /><span>{formatNumber(reposts)}</span></button>
          <button onClick={toggleLike} disabled={Boolean(busy)} aria-pressed={liked} className={`flex items-center gap-1.5 hover:text-pink-500 ${liked ? 'text-pink-500' : ''}`}><Heart className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} /><span>{formatNumber(likes)}</span></button>
          <button onClick={quote} disabled={Boolean(busy)} title="Quote" aria-label="Quote" className="hover:text-blue-500"><Quote className="w-4 h-4" /></button>
          <button onClick={toggleBookmark} disabled={Boolean(busy)} title={bookmarked ? 'Remove bookmark' : 'Bookmark'} aria-pressed={bookmarked} className={`hover:text-primary ${bookmarked ? 'text-primary' : ''}`}><Bookmark className="w-4 h-4" fill={bookmarked ? 'currentColor' : 'none'} /></button>
          <button onClick={share} disabled={Boolean(busy)} title="Share" aria-label="Share" className="hover:text-primary">{busy === 'share' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}</button>
          <button onClick={translate} disabled={translating || Boolean(busy)} title="Translate" aria-label="Translate" className="hover:text-blue-500">{translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}</button>
        </div>
        {replyOpen && <div className="mt-3 flex items-center gap-2"><input value={replyText} onChange={e => setReplyText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitReply(); }} placeholder="Reply / comment…" className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" maxLength={1000} /><button onClick={submitReply} disabled={!replyText.trim() || Boolean(busy)} className="p-2 rounded-full bg-primary text-primary-foreground disabled:opacity-40">{busy === 'reply' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</button></div>}
      </div>
    </div>
  </article>;
}
