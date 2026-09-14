import { supabase } from '@/lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';

async function sessionToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function searchFunction(body: Record<string, unknown>): Promise<any[]> {
  const token = await sessionToken();
  const { data, error } = await supabase.functions.invoke('search-everything', {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (error) {
    let message = error.message || 'Search service failed';
    if (error instanceof FunctionsHttpError) {
      try {
        const text = await error.context?.text();
        message = text || message;
      } catch {}
    }
    throw new Error(message);
  }
  return Array.isArray(data) ? data : [];
}

export async function unifiedSearch(query: string, type = 'all', limit = 40): Promise<any[]> {
  const q = query.trim();
  if (!q) return [];
  return searchFunction({ q, type, limit });
}

export async function unifiedHashtagFeed(tag: string, limit = 50): Promise<any[]> {
  const clean = tag.trim().replace(/^#/, '').toLowerCase();
  if (!clean) return [];
  return searchFunction({ operation: 'hashtag_feed', tag: clean, limit });
}

export async function followHashtag(hashtagId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Authentication required');
  const { error } = await supabase.from('hashtag_follows').upsert(
    { user_id: userId, hashtag_id: hashtagId },
    { onConflict: 'user_id,hashtag_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function unfollowHashtag(hashtagId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Authentication required');
  const { error } = await supabase.from('hashtag_follows').delete().eq('user_id', userId).eq('hashtag_id', hashtagId);
  if (error) throw error;
}

export async function isFollowingHashtag(hashtagId: string): Promise<boolean> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return false;
  const { data, error } = await supabase.from('hashtag_follows').select('id').eq('user_id', userId).eq('hashtag_id', hashtagId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function setNativeFollow(targetUserId: string, follow: boolean): Promise<any> {
  const { data, error } = await supabase.rpc('set_follow_state', { p_following_id: targetUserId, p_follow: follow });
  if (error) throw error;
  return data ?? {};
}

export async function getNativeFollowState(targetUserId: string): Promise<any> {
  const { data, error } = await supabase.rpc('get_follow_state', { p_following_id: targetUserId });
  if (error) throw error;
  return data ?? { following: false, requested: false, followed_by: false, status: 'none' };
}
