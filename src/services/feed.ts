import { supabase } from '@/lib/supabase';
import * as federation from '@/api/federation';

export type Post = {
  id: string;
  content: string;
  created_at: string;
  author: any;
  origin: 'local' | 'federated';
  federation_id?: string;
  visibility?: string;
  [k: string]: any;
};

function normalizeLocal(row: any): Post {
  return {
    id: `local:${row.id}`,
    content: row.body ?? row.content ?? '',
    created_at: row.created_at,
    author: row.author ?? row.profiles ?? null,
    origin: 'local',
    ...row,
  };
}

function normalizeFederated(item: any): Post {
  return {
    id: `fed:${item.id ?? item.federation_id}`,
    content: item.content ?? item.html ?? '',
    created_at: item.created_at ?? item.published ?? new Date().toISOString(),
    author: item.author,
    origin: 'federated',
    federation_id: item.id ?? item.federation_id,
    ...item,
  };
}

export async function getMergedHomeTimeline({ limit = 20, before }: { limit?: number; before?: string } = {}) {
  let localRes: any = { data: [], error: null };
  try {
    const query = supabase
      .from('posts')
      .select('*,author:profiles!posts_author_id_fkey(*)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) query.lt('created_at', before);
    localRes = await query;
  } catch (err) {
    console.warn('[feed] failed to fetch local posts', err);
  }

  let fedRes: any = { posts: [] };
  try {
    fedRes = await federation.getHomeTimeline({ limit, before });
  } catch (err) {
    console.warn('[feed] failed to fetch federated timeline', err);
  }

  const localPosts = (localRes?.data ?? []).map(normalizeLocal);
  const fedPosts = (fedRes?.posts ?? []).map(normalizeFederated);

  const map = new Map<string, Post>();
  [...localPosts, ...fedPosts].forEach((p) => {
    const key = p.federation_id ?? p.id;
    if (!map.has(key) || new Date(p.created_at) > new Date(map.get(key)!.created_at)) {
      map.set(key, p);
    }
  });

  const merged = Array.from(map.values()).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  return { posts: merged, next_cursor: merged.at(-1)?.created_at };
}
