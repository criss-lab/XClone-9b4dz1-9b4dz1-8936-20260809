import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Globe, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import * as federation from '@/api/federation';
import { FederatedPostCard } from '@/components/features/FederatedPostCard';
import { useSEO } from '@/hooks/useSEO';

function normalizePost(value: any) {
  if (!value) return null;
  const raw = value.raw_object ?? value.object ?? {};
  const actor = value.actor ?? value.account ?? value.remote_accounts ?? {};
  const canonicalObjectUrl = value.object_url ?? value.uri ?? value.url ?? raw.id ?? raw.url ?? value.id ?? '';
  return {
    ...raw, ...value,
    actor: value.actor ?? raw.actor ?? value.account ?? { ...actor, preferredUsername: actor.preferredUsername ?? actor.username, name: actor.name ?? actor.display_name, url: actor.url ?? value.actor_url, icon: actor.icon ?? (actor.avatar_url ? { url: actor.avatar_url } : undefined), acct: actor.acct ?? (actor.username && actor.domain ? `${actor.username}@${actor.domain}` : actor.username) },
    id: canonicalObjectUrl, object_url: canonicalObjectUrl,
    url: value.url ?? value.object_url ?? value.uri ?? raw.url ?? raw.id ?? canonicalObjectUrl,
    uri: value.uri ?? value.object_url ?? raw.id ?? canonicalObjectUrl,
    content: value.content ?? raw.content ?? value.text ?? raw.text ?? '',
    created_at: value.created_at ?? value.published_at ?? raw.created_at ?? raw.published ?? '',
    media_attachments: value.media_attachments ?? raw.media_attachments ?? value.media_urls ?? value.attachments ?? [],
  };
}

function uniqueCandidates(...values: unknown[]): string[] {
  return [...new Set(values.flatMap(value => typeof value === 'string' && value.trim() ? [value.trim()] : []))];
}

export default function FediversePostPage() {
  const location = useLocation(); const navigate = useNavigate();
  const [post, setPost] = useState<any>(() => normalizePost(location.state?.post));
  const [loading, setLoading] = useState(!post); const [error, setError] = useState('');
  const objectUrl = useMemo(() => new URLSearchParams(location.search).get('url') || post?.object_url || post?.url || post?.uri || post?.id || '', [location.search, post]);
  useSEO({ title: post ? `${post.actor?.name ?? post.actor?.preferredUsername ?? 'Fediverse post'} on Testagram` : 'Fediverse post — Testagram', description: post ? String(post.content ?? '').replace(/<[^>]*>/g, '').slice(0, 155) : 'View a Fediverse post inside Testagram.', url: `/fediverse/post?url=${encodeURIComponent(objectUrl)}`, type: 'article' });

  useEffect(() => {
    if (!objectUrl || post) { if (post) setLoading(false); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const candidates = uniqueCandidates(objectUrl, decodeURIComponent(objectUrl)); let cached: any = null;
        for (const candidate of candidates) {
          const [legacyResult, uriResult, urlResult] = await Promise.all([
            supabase.from('remote_posts').select('*, remote_accounts(*)').eq('object_url', candidate).maybeSingle(),
            supabase.from('federated_objects').select('*').eq('uri', candidate).maybeSingle(),
            supabase.from('federated_objects').select('*').eq('url', candidate).maybeSingle(),
          ]);
          cached = legacyResult.data ?? uriResult.data ?? urlResult.data; if (cached) break;
        }
        if (cached) { if (!cancelled) setPost(normalizePost(cached)); return; }
        const timeline: any = await federation.getFederatedTimeline({ limit: 100 });
        const items: any[] = Array.isArray(timeline) ? timeline : (timeline?.posts ?? timeline?.data ?? []);
        const match = items.find(item => candidates.some(candidate => uniqueCandidates(item.object_url, item.uri, item.url, item.id, item.raw_object?.id, item.raw_object?.url).includes(candidate)));
        if (!match) throw new Error('This Fediverse post could not be resolved from the canonical remote object.');
        if (!cancelled) setPost(normalizePost(match));
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load this Fediverse post.'); }
      finally { if (!cancelled) setLoading(false); }
    };
    void load(); return () => { cancelled = true; };
  }, [objectUrl, post]);

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!post) return <div className="min-h-screen bg-background"><div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border p-3 flex items-center gap-3"><button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-muted" aria-label="Go back"><ArrowLeft className="w-5 h-5" /></button><h1 className="font-bold">Fediverse post</h1></div><div className="p-8 text-center text-muted-foreground"><Globe className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="font-semibold">Unable to open this post in Testagram</p><p className="text-sm mt-1">{error || 'The remote post could not be resolved.'}</p><button onClick={() => navigate('/fediverse')} className="mt-5 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold">Back to Fediverse</button></div></div>;
  return <div className="min-h-screen bg-background pb-20 md:pb-0"><div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border p-3 flex items-center gap-3"><button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-muted" aria-label="Go back"><ArrowLeft className="w-5 h-5" /></button><div><h1 className="font-bold">Post</h1><p className="text-[11px] text-muted-foreground flex items-center gap-1"><Globe className="w-3 h-3" />Fediverse · viewed in Testagram</p></div></div><FederatedPostCard post={post} disableNavigation /><div className="px-4 py-3 text-center text-xs text-muted-foreground border-t border-border">This remote post is rendered inside Testagram. Your interactions are sent through the federation gateway.</div></div>;
}
