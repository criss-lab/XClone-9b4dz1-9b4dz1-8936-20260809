/**
 * Testagram Recommendation Engine
 * Production-schema implementation: follows, mutes, blocks, interests,
 * post engagement counters, post_hashtags and post_views.
 */

import { supabase } from '@/lib/supabase';

export interface ScoredPost {
  post: any;
  score: number;
  reason: string;
  source: 'interest' | 'social' | 'viral' | 'following' | 'new';
}

export interface FeedSignals {
  followingIds: string[];
  mutedIds: string[];
  blockedIds: string[];
  interestTags: string[];
  likedPostIds: string[];
  viewedPostIds: string[];
}

const ENGAGEMENT_WEIGHTS = {
  like: 2.0,
  repost: 3.0,
  reply: 1.5,
  view: 0.05,
  tip: 5.0,
  bookmark: 4.0,
};

const RECENCY_HALF_LIFE_HOURS = 12;
const VERIFIED_BONUS = 5;
const VIDEO_BONUS = 8;
const MEDIA_BONUS = 4;
const FOLLOWING_BONUS = 20;
const INTEREST_BONUS = 15;
const VIRAL_THRESHOLD = 500;

function authorId(post: any): string | null {
  return post.author_id ?? post.user_id ?? post.author?.id ?? null;
}

function likeCount(post: any): number {
  return Number(post.like_count ?? post.likes_count ?? 0);
}

function repostCount(post: any): number {
  return Number(post.repost_count ?? post.reposts_count ?? 0);
}

function replyCount(post: any): number {
  return Number(post.reply_count ?? post.replies_count ?? 0);
}

function viewCount(post: any): number {
  return Number(post.view_count ?? post.views_count ?? 0);
}

export function scorePost(post: any, signals: FeedSignals): { score: number; reason: string } {
  const ageHours = Math.max(0, (Date.now() - new Date(post.created_at).getTime()) / 3_600_000);
  const engagementScore =
    likeCount(post) * ENGAGEMENT_WEIGHTS.like +
    repostCount(post) * ENGAGEMENT_WEIGHTS.repost +
    replyCount(post) * ENGAGEMENT_WEIGHTS.reply +
    viewCount(post) * ENGAGEMENT_WEIGHTS.view;
  const decayFactor = Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_HOURS);
  const mediaBonus = post.media_type === 'video' || post.video_url ? VIDEO_BONUS : post.media_url ? MEDIA_BONUS : 0;
  const verifiedBonus = post.author?.verified_tier && post.author.verified_tier !== 'none' ? VERIFIED_BONUS : 0;
  const uid = authorId(post);
  const followingBonus = uid && signals.followingIds.includes(uid) ? FOLLOWING_BONUS : 0;
  const postTags: string[] = (post._hashtag_tags ?? []).map((t: string) => t.toLowerCase());
  const interestBonus = postTags.some(t => signals.interestTags.includes(t)) ? INTEREST_BONUS : 0;
  const viralBonus = viewCount(post) >= VIRAL_THRESHOLD ? 5 : 0;
  const total = engagementScore * decayFactor + mediaBonus + verifiedBonus + followingBonus + interestBonus + viralBonus;

  let reason = 'New content';
  if (followingBonus) reason = 'From someone you follow';
  else if (interestBonus) reason = 'Matches your interests';
  else if (viewCount(post) >= VIRAL_THRESHOLD) reason = 'Trending now';
  else if (likeCount(post) > 50) reason = 'Highly liked';

  return { score: total, reason };
}

export async function loadUserSignals(userId: string): Promise<FeedSignals> {
  const [followingRes, mutedRes, blockedRes, interestRes, likedRes, viewedRes] = await Promise.allSettled([
    supabase.from('follows').select('following_id').eq('follower_id', userId).limit(200),
    supabase.from('mutes').select('muted_id').eq('muter_id', userId).limit(100),
    supabase.from('user_blocks').select('blocked_id').eq('blocker_id', userId).limit(100),
    supabase.from('user_interests').select('hashtags:hashtag_id(tag)').eq('user_id', userId).order('interest_score', { ascending: false }).limit(50),
    supabase.from('post_likes').select('post_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
    supabase.from('post_views').select('post_id').eq('viewer_id', userId).order('last_viewed_at', { ascending: false }).limit(100),
  ]);

  const followingIds = followingRes.status === 'fulfilled' ? (followingRes.value.data ?? []).map((r: any) => r.following_id) : [];
  const mutedIds = mutedRes.status === 'fulfilled' ? (mutedRes.value.data ?? []).map((r: any) => r.muted_id) : [];
  const blockedIds = blockedRes.status === 'fulfilled' ? (blockedRes.value.data ?? []).map((r: any) => r.blocked_id) : [];
  const interestTags = interestRes.status === 'fulfilled'
    ? (interestRes.value.data ?? []).map((r: any) => r.hashtags?.tag).filter(Boolean).map((t: string) => t.toLowerCase())
    : [];
  const likedPostIds = likedRes.status === 'fulfilled' ? (likedRes.value.data ?? []).map((r: any) => r.post_id) : [];
  const viewedPostIds = viewedRes.status === 'fulfilled' ? (viewedRes.value.data ?? []).map((r: any) => r.post_id).filter(Boolean) : [];

  return { followingIds, mutedIds, blockedIds, interestTags, likedPostIds, viewedPostIds };
}

function blockedAuthorSet(signals: FeedSignals): Set<string> {
  return new Set([...signals.mutedIds, ...signals.blockedIds]);
}

async function attachHashtags(posts: any[]): Promise<any[]> {
  if (!posts.length) return posts;
  const ids = posts.map(p => p.id);
  const { data: links } = await supabase
    .from('post_hashtags')
    .select('post_id,hashtags:hashtag_id(tag)')
    .in('post_id', ids);
  const tagsByPost: any = {};
  for (const link of links ?? []) {
    if (!tagsByPost[link.post_id]) tagsByPost[link.post_id] = [];
    if (link.hashtags?.tag) tagsByPost[link.post_id].push(String(link.hashtags.tag).toLowerCase());
  }
  return posts.map(p => ({ ...p, _hashtag_tags: tagsByPost[p.id] ?? [] }));
}

async function fetchPostsForAuthors(authorIds: string[], limit: number): Promise<any[]> {
  if (!authorIds.length) return [];
  const { data } = await supabase
    .from('posts')
    .select('*,author:profiles!posts_author_id_fkey(*)')
    .in('author_id', authorIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function fetchCandidates(userId: string, signals: FeedSignals, limit = 100): Promise<{ post: any; source: ScoredPost['source'] }[]> {
  const candidates: { post: any; source: ScoredPost['source'] }[] = [];
  const seenIds = new Set<string>(signals.viewedPostIds.slice(0, 50));
  const hiddenAuthors = blockedAuthorSet(signals);

  const followingPosts = await fetchPostsForAuthors(signals.followingIds, Math.round(limit * 0.8));
  for (const post of await attachHashtags(followingPosts)) {
    const uid = authorId(post);
    if (!uid || hiddenAuthors.has(uid) || seenIds.has(post.id)) continue;
    candidates.push({ post, source: 'following' });
    seenIds.add(post.id);
  }

  if (signals.interestTags.length) {
    const { data: tags } = await supabase.from('hashtags').select('id').in('tag', signals.interestTags.slice(0, 20));
    const tagIds = (tags ?? []).map((r: any) => r.id);
    if (tagIds.length) {
      const { data: links } = await supabase.from('post_hashtags').select('post_id').in('hashtag_id', tagIds).limit(200);
      const postIds = [...new Set((links ?? []).map((r: any) => r.post_id))];
      if (postIds.length) {
        const { data: posts } = await supabase
          .from('posts')
          .select('*,author:profiles!posts_author_id_fkey(*)')
          .in('id', postIds.slice(0, 50))
          .is('deleted_at', null)
          .order('like_count', { ascending: false });
        for (const post of await attachHashtags(posts ?? [])) {
          const uid = authorId(post);
          if (!uid || uid === userId || hiddenAuthors.has(uid) || seenIds.has(post.id)) continue;
          candidates.push({ post, source: 'interest' });
          seenIds.add(post.id);
        }
      }
    }
  }

  const { data: viral } = await supabase
    .from('posts')
    .select('*,author:profiles!posts_author_id_fkey(*)')
    .is('deleted_at', null)
    .order('like_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30);
  for (const post of await attachHashtags(viral ?? [])) {
    const uid = authorId(post);
    if (!uid || uid === userId || hiddenAuthors.has(uid) || seenIds.has(post.id)) continue;
    candidates.push({ post, source: viewCount(post) >= VIRAL_THRESHOLD ? 'viral' : 'new' });
    seenIds.add(post.id);
  }

  return candidates;
}

export async function buildPersonalizedFeed(userId: string, limit = 50): Promise<ScoredPost[]> {
  const signals = await loadUserSignals(userId);
  const candidates = await fetchCandidates(userId, signals, limit * 2);
  const scored = candidates.map(({ post, source }) => {
    const { score, reason } = scorePost(post, signals);
    return { post, score, reason, source };
  });
  scored.sort((a, b) => b.score - a.score);

  const result: ScoredPost[] = [];
  const authorCount: any = {};
  for (const item of scored) {
    const uid = authorId(item.post) ?? 'unknown';
    if ((authorCount[uid] ?? 0) >= 3) continue;
    authorCount[uid] = (authorCount[uid] ?? 0) + 1;
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

export async function buildFollowingFeed(userId: string, followingIds: string[], page = 0, pageSize = 20): Promise<ScoredPost[]> {
  if (!followingIds.length) return [];
  const signals = await loadUserSignals(userId);
  const hiddenAuthors = blockedAuthorSet(signals);
  const offset = page * pageSize;
  const { data } = await supabase
    .from('posts')
    .select('*,author:profiles!posts_author_id_fkey(*)')
    .in('author_id', followingIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);
  const posts = (data ?? []).filter((p: any) => {
    const uid = authorId(p);
    return uid && !hiddenAuthors.has(uid);
  });
  const hydrated = await attachHashtags(posts);
  return hydrated.map((post: any) => {
    const { score, reason } = scorePost(post, signals);
    return { post, score, reason, source: 'following' as const };
  });
}

export async function updateInterestSignal(userId: string, postId: string, signal: 'like' | 'repost' | 'bookmark' | 'view', weight = 1) {
  const { data: phs } = await supabase.from('post_hashtags').select('hashtag_id,hashtags:hashtag_id(tag)').eq('post_id', postId).limit(10);
  if (!phs?.length) return;
  const signalWeight = ENGAGEMENT_WEIGHTS[signal] ?? 1;
  const delta = signalWeight * weight * 0.1;
  for (const row of phs as any[]) {
    const tag = row.hashtags?.tag;
    if (!tag) continue;
    const { data: existing } = await supabase
      .from('user_interests')
      .select('user_id,hashtag_id,interest_score')
      .eq('user_id', userId)
      .eq('hashtag_id', row.hashtag_id)
      .maybeSingle();
    if (existing) {
      await supabase.from('user_interests').update({ interest_score: Math.min(Number(existing.interest_score ?? 1) + delta, 10), last_interaction: new Date().toISOString(), topic: tag }).eq('user_id', userId).eq('hashtag_id', row.hashtag_id);
    } else {
      await supabase.from('user_interests').insert({ user_id: userId, hashtag_id: row.hashtag_id, topic: tag, interest_score: delta, last_interaction: new Date().toISOString() });
    }
  }
}
