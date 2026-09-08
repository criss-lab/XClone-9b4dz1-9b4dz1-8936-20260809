
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Input } from '@/components/ui/input';
import {
  Search, Loader2, BadgeCheck, Globe, ExternalLink, UserPlus, Hash, Users, Clock, X, TrendingUp,
  Sparkles, Flame, Brain, Filter, Image, Video, CheckCircle2, Calendar, History, BarChart2, Download, Trash2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PostCard } from '@/components/features/PostCard';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import * as federation from '@/api/federation';
import { formatNumber } from '@/lib/utils';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { DynamicAd } from '@/components/features/DynamicAd';
import { useSEO } from '@/hooks/useSEO';

function SearchAdBanner() { return <PageAdBanner />; }

// esbuild guard: module-level plain arrays (no 'as const', not inside component body)
const CONTENT_TYPE_FILTERS: string[] = ['All', 'Posts', 'Videos', 'Users', 'Hashtags', 'Threads'];
const SORT_OPTIONS: string[] = ['Newest', 'Most Liked', 'Most Viewed'];
// esbuild guard: parallel arrays replace Record<tier,meta> inside .map()
const TIER_KEYS: string[] = ['gold', 'silver', 'bronze'];
const TIER_EMOJIS: string[] = ['🥇', '🥈', '🥉'];

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState(searchParams.get('q') || '');

  // ── SEO — dynamic title + WebSite SearchAction JSON-LD ──────────────────
  useSEO({
    title: query.trim()
      ? `Search: "${query.trim()}" — Testagram`
      : 'Search — Discover People, Posts & Hashtags',
    description: query.trim()
      ? `Testagram search results for "${query.trim()}". Find posts, people, hashtags, and communities.`
      : 'Search Testagram to find creators, posts, trending hashtags, and communities from around the world.',
    url: query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : '/search',
    type: 'website',
    keywords: query.trim()
      ? `${query.trim()}, search, testagram, find, discover`
      : 'search, discover, find people, hashtags, testagram, communities',
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Testagram',
      url: 'https://testagram.site',
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: 'https://testagram.site/search?q={search_term_string}',
        },
        'query-input': 'required name=search_term_string',
      },
    },
  });
  const [activeTab, setActiveTab] = useState('For You');
  const [posts, setPosts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [hashtags, setHashtags] = useState<any[]>([]);
  const [communities, setCommunities] = useState<any[]>([]);
  const [fediverseResults, setFediverseResults] = useState<any[]>([]);
  // ── Content-type filter + sort state ──────────────────────────────────────
  // (CONTENT_TYPE_FILTERS and SORT_OPTIONS are at module level — esbuild guard)
  const [contentTypeFilter, setContentTypeFilter] = useState('All');
  const [sortOption, setSortOption] = useState('Most Viewed');
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  const [threads, setThreads] = useState<any[]>([]);

  // Apply content-type filter to re-route the active tab
  // esbuild guard: plain untyped object (no Record<string,string> annotation)
  const ctfTabMap = { Posts: 'Posts', Videos: 'Posts', Users: 'Users', Hashtags: 'Hashtags', Threads: 'For You' };
  useEffect(() => {
    if (contentTypeFilter === 'All') return;
    setActiveTab((ctfTabMap as any)[contentTypeFilter] ?? activeTab);
  }, [contentTypeFilter]);

  const sortPosts = (rawPosts: any[]) => {
    if (sortOption === 'Newest') return [...rawPosts].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (sortOption === 'Most Liked') return [...rawPosts].sort((a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0));
    return [...rawPosts].sort((a, b) => (b.views_count ?? 0) - (a.views_count ?? 0));
  };

  const getFilteredPosts = () => {
    let result = applyFilters(posts);
    if (contentTypeFilter === 'Videos') result = result.filter(p => p.is_video || p.video_url);
    else if (contentTypeFilter === 'Posts') result = result.filter(p => !p.is_video && !p.video_url);
    return sortPosts(result);
  };

  const [loading, setLoading] = useState(false);
  const [fediverseLoading, setFediverseLoading] = useState(false);

  // ── Smart Discovery state (shown when no query) ─────────────────────────
  const [suggestedUsers, setSuggestedUsers] = useState<any[]>([]);
  const [trendingHashtags, setTrendingHashtags] = useState<any[]>([]);
  const [forYouPosts, setForYouPosts] = useState<any[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const [aiSearchResult, setAiSearchResult] = useState<string | null>(null);
  const [aiSearching, setAiSearching] = useState(false);

  // ── Autocomplete + recent searches state (declared early — used in searchTermFrequency below) ──
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [acUsers, setAcUsers] = useState<any[]>([]);
  const [acHashtags, setAcHashtags] = useState<any[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('tsocial_recent_searches') || '[]') as string[];
      setRecentSearches(stored.slice(0, 6));
    } catch {}
  }, []);

  // ── Search History Analytics ─────────────────────────────────────────────────
  const [userInterests, setUserInterests] = useState<any[]>([]);

  // recentSearches is declared above — no forward reference
  const searchTermFrequency = useMemo(() => {
    const freq: Record<string, number> = {};
    recentSearches.forEach(s => { freq[s] = (freq[s] ?? 0) + 1; });
    try {
      const all = JSON.parse(localStorage.getItem('tsocial_all_searches') || '[]') as string[];
      all.forEach(s => { freq[s] = (freq[s] ?? 0) + 1; });
    } catch {}
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [recentSearches]);

  // ── Search Filters ──────────────────────────────────────────────────────────
  type DateFilter = 'all' | '24h' | 'week' | 'month';
  type MediaFilter = 'all' | 'images' | 'videos';
  const [filterDate, setFilterDate] = useState<DateFilter>('all');
  const [filterMedia, setFilterMedia] = useState<MediaFilter>('all');
  const [filterVerified, setFilterVerified] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const applyFilters = (rawPosts: any[]) => {
    let result = [...rawPosts];
    if (filterDate !== 'all') {
      const cutoff = new Date();
      if (filterDate === '24h') cutoff.setHours(cutoff.getHours() - 24);
      else if (filterDate === 'week') cutoff.setDate(cutoff.getDate() - 7);
      else if (filterDate === 'month') cutoff.setMonth(cutoff.getMonth() - 1);
      result = result.filter(p => new Date(p.created_at) >= cutoff);
    }
    if (filterMedia === 'images') result = result.filter(p => p.image_url || (p.media_urls && p.media_urls.length > 0 && !p.is_video));
    else if (filterMedia === 'videos') result = result.filter(p => p.is_video || p.video_url);
    if (filterVerified) result = result.filter(p => p.user_profiles?.verified);
    return result;
  };

  const activeFilterCount = (filterDate !== 'all' ? 1 : 0) + (filterMedia !== 'all' ? 1 : 0) + (filterVerified ? 1 : 0);
  const acDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const tabs = ['For You', 'Posts', 'Users', 'Hashtags', 'Communities', 'Fediverse'];

  // Click-outside to close autocomplete
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowAutocomplete(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Load smart discovery data (no query) ─────────────────────────────────
  const loadDiscovery = useCallback(async () => {
    setDiscoveryLoading(true);
    try {
      const [trendingRes, topUsersRes, interestPostsRes] = await Promise.all([
        // Trending hashtags
        supabase.from('trending_hashtags')
          .select('*, hashtags(tag, usage_count)')
          .order('trend_score', { ascending: false })
          .limit(12),

        // Top suggested users (personalized if logged in)
        user
          ? supabase.from('user_suggestions')
              .select('suggested_user_id, reason, score, user_profiles!user_suggestions_suggested_user_id_fkey(id, username, avatar_url, verified, followers_count, bio, creator_tier)')
              .eq('user_id', user.id)
              .order('score', { ascending: false })
              .limit(8)
          : supabase.from('user_profiles')
              .select('id, username, avatar_url, verified, followers_count, bio, creator_tier')
              .order('followers_count', { ascending: false })
              .limit(8),

        // For-You feed: interest-matched posts or popular posts
        user
          ? supabase.from('content_recommendations')
              .select('recommended_post_id, reason, posts!content_recommendations_recommended_post_id_fkey(*, user_profiles(*))')
              .eq('user_id', user.id)
              .eq('shown', false)
              .order('score', { ascending: false })
              .limit(10)
          : supabase.from('posts')
              .select('*, user_profiles(*)')
              .order('views_count', { ascending: false })
              .limit(10),
      ]);

      setTrendingHashtags((trendingRes.data ?? []).map((r: any) => r.hashtags).filter(Boolean));

      if (user) {
        const sugUsers = (topUsersRes.data ?? [])
          .map((r: any) => ({ ...r.user_profiles, _reason: r.reason }))
          .filter(Boolean);
        setSuggestedUsers(sugUsers);

        const recPosts = (interestPostsRes.data ?? [])
          .map((r: any) => r.posts)
          .filter(Boolean);
        setForYouPosts(recPosts);
      } else {
        setSuggestedUsers((topUsersRes.data as any[] ?? []).map((u: any) => u));
        setForYouPosts((interestPostsRes.data as any[] ?? []));
      }
    } catch (err) {
      console.error('Discovery load error:', err);
    } finally {
      setDiscoveryLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadDiscovery();
  }, [loadDiscovery]);

  // ── AI-powered search enhancement ──────────────────────────────────────
  const doAiSearch = async (q: string) => {
    if (!q.trim() || q.trim().length < 3) return;
    setAiSearching(true);
    setAiSearchResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: {
          messages: [{
            role: 'user',
            content: `You are a smart social media search assistant. The user searched for: "${q}".
Provide a concise 1-2 sentence insight about this topic that would help users find relevant content.
Also suggest 3 related search terms as hashtags (e.g., #tech #startup). Keep it under 60 words total.`,
          }],
          model: 'gemini-2.0-flash',
        },
      });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const text = await error.context?.text?.();
          console.warn('[ai-search]', text);
        }
        return;
      }
      const result = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? '';
      if (result.trim()) setAiSearchResult(result.trim());
    } catch { /* non-critical */ } finally {
      setAiSearching(false);
    }
  };

  const fetchAutocomplete = async (q: string) => {
    if (!q.trim()) { setAcUsers([]); setAcHashtags([]); return; }
    const clean = q.replace(/^[@#]/, '');
    const isHash = q.startsWith('#');
    const isUser = q.startsWith('@');
    const [ur, hr] = await Promise.all([
      isHash ? Promise.resolve({ data: [] as any[] }) :
        supabase.from('user_profiles').select('id,username,avatar_url,verified,followers_count')
          .ilike('username', `${clean}%`).order('followers_count', { ascending: false }).limit(5),
      isUser ? Promise.resolve({ data: [] as any[] }) :
        supabase.from('hashtags').select('id,tag,usage_count')
          .ilike('tag', `${clean}%`).order('usage_count', { ascending: false }).limit(4),
    ]);
    setAcUsers(ur.data || []);
    setAcHashtags(hr.data || []);
  };

  // Load user interests for the analytics display
  useEffect(() => {
    if (!user) return;
    supabase.from('user_interests').select('interest_score, hashtags(tag)').eq('user_id', user.id).order('interest_score', { ascending: false }).limit(12).then(({ data }) => {
      setUserInterests((data ?? []).filter((r: any) => r.hashtags).map((r: any) => ({ tag: r.hashtags.tag, score: r.interest_score })));
    });
  }, [user?.id]);

  const saveRecentSearch = (q: string) => {
    if (!q.trim()) return;
    const updated = [q, ...recentSearches.filter(s => s !== q)].slice(0, 6);
    setRecentSearches(updated);
    try { localStorage.setItem('tsocial_recent_searches', JSON.stringify(updated)); } catch {}
    // Save to all-time list for analytics
    try {
      const all = JSON.parse(localStorage.getItem('tsocial_all_searches') || '[]') as string[];
      const updatedAll = [q, ...all.filter(s => s !== q)].slice(0, 100);
      localStorage.setItem('tsocial_all_searches', JSON.stringify(updatedAll));
    } catch {}
  };

  const clearRecentSearch = (q: string) => {
    const updated = recentSearches.filter(s => s !== q);
    setRecentSearches(updated);
    try { localStorage.setItem('tsocial_recent_searches', JSON.stringify(updated)); } catch {}
  };

  // ── Smart search scoring: boost by engagement + recency ─────────────────
  const scorePost = useCallback((post: any, q: string) => {
    const lower = q.toLowerCase();
    let score = 0;
    if (post.content?.toLowerCase().includes(lower)) score += 10;
    score += (post.views_count ?? 0) * 0.001;
    score += (post.likes_count ?? 0) * 0.05;
    score += (post.reposts_count ?? 0) * 0.03;
    const age = Date.now() - new Date(post.created_at).getTime();
    const daysSince = age / (1000 * 60 * 60 * 24);
    score *= Math.max(0.1, 1 - daysSince * 0.03); // decay over time
    if (post.user_profiles?.verified) score += 3;
    if (post.is_video) score += 2;
    return score;
  }, []); // No dependencies, as it only uses its arguments

  const scoreUser = useCallback((u: any, q: string) => {
    const lower = q.toLowerCase();
    let score = u.followers_count ?? 0;
    if (u.username?.toLowerCase().startsWith(lower)) score += 500;
    if (u.verified) score += 200;
    if (u.is_creator) score += 100;
    return score;
  }, []); // No dependencies, as it only uses its arguments


  // Memoize performSearch to prevent unnecessary re-renders and re-creations
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setLoading(true);

    try {
      const clean = searchQuery.replace(/^#/, '');
      // Also fetch threads if content type filter includes threads
      const [postsRes, usersRes, hashtagsRes, communitiesRes, threadsRes] = await Promise.all([
        supabase
          .from('posts')
          .select('*, user_profiles (*)')
          .or(`content.ilike.%${clean}%,content.ilike.%${searchQuery}%`)
          .order('views_count', { ascending: false })
          .limit(80),
        supabase
          .from('user_profiles')
          .select('*')
          .or(`username.ilike.%${clean}%,bio.ilike.%${clean}%`)
          .limit(30),
        supabase
          .from('hashtags')
          .select('*')
          .ilike('tag', `%${clean}%`)
          .order('usage_count', { ascending: false })
          .limit(25),
        supabase
          .from('communities')
          .select('*')
          .or(`name.ilike.%${clean}%,display_name.ilike.%${clean}%,description.ilike.%${clean}%`)
          .order('member_count', { ascending: false })
          .limit(20),
        supabase
          .from('threads')
          .select('*, user_profiles(*)')
          .or(`title.ilike.%${clean}%,content.ilike.%${clean}%`)
          .eq('is_published', true)
          .order('views_count', { ascending: false })
          .limit(20),
      ]);

      setThreads(threadsRes.data ?? []);

      // Apply smart scoring
      const scoredPosts = (postsRes.data || [])
        .map(p => ({ ...p, _score: scorePost(p, clean) }))
        .sort((a, b) => b._score - a._score);

      const scoredUsers = (usersRes.data || [])
        .map(u => ({ ...u, _score: scoreUser(u, clean) }))
        .sort((a, b) => b._score - a._score);

      setPosts(scoredPosts);
      setUsers(scoredUsers);
      setHashtags(hashtagsRes.data || []);
      setCommunities(communitiesRes.data || []);

      // ── Fediverse search ────────────────────────────────────────────────
      setFediverseLoading(true);
      try {
        const { data: remoteData } = await supabase
          .from('remote_accounts')
          .select('*')
          .or(`username.ilike.%${clean}%,domain.ilike.%${clean}%,display_name.ilike.%${clean}%`)
          .limit(20);
        setFediverseResults(remoteData || []);
      } catch { setFediverseResults([]); }

      try {
        const gwResult: any = await federation.search(clean, 'users');
        const accounts: any[] = Array.isArray(gwResult) ? gwResult : gwResult?.accounts ?? gwResult?.users ?? gwResult?.data ?? [];
        if (accounts.length > 0) {
          const mapped = accounts.map((a: any) => ({
            actor_url: a.url ?? a.id ?? a.actor_url ?? '',
            username: a.username ?? a.preferredUsername ?? a.acct?.split('@')[0] ?? '',
            domain: a.acct?.split('@')[1] ?? a.domain ?? (a.url ? (() => { try { return new URL(a.url).hostname; } catch { return ''; } })() : ''),
            display_name: a.display_name ?? a.name ?? a.username ?? '',
            bio: a.note ?? a.summary ?? a.bio ?? '',
            avatar_url: a.avatar ?? a.avatar_static ?? a.avatar_url ?? a.icon?.url ?? null,
          })).filter((a: any) => a.username && a.actor_url);
          setFediverseResults(prev => {
            const existing = new Set(prev.map((r: any) => r.actor_url));
            return [...prev, ...mapped.filter((a: any) => !existing.has(a.actor_url))];
          });
        }
      } catch {}

      if (clean.includes('@')) {
        try {
          const actor = await federation.getUser(clean);
          if (actor) {
            const account = { actor_url: actor.id || clean, username: actor.preferredUsername || clean.split('@')[0], domain: clean.split('@')[1] || '', display_name: actor.name ?? actor.preferredUsername, bio: actor.summary, avatar_url: actor.icon?.url ?? actor.avatar_url, raw_actor: actor };
            setFediverseResults(prev => prev.some(r => r.actor_url === account.actor_url) ? prev : [account, ...prev]);
          }
        } catch {}
      }
      setFediverseLoading(false);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  }, [scorePost, scoreUser]); // Dependencies for useCallback. scorePost and scoreUser are now included.

  const doAiSearchCallback = useCallback((q: string) => doAiSearch(q), []); // Wrap doAiSearch in useCallback

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      setQuery(q);
      performSearch(q);
      doAiSearchCallback(q);
    }
  }, [searchParams, performSearch, doAiSearchCallback]); // Added performSearch and doAiSearchCallback to dependencies

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      saveRecentSearch(query.trim());
      setShowAutocomplete(false);
      navigate(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setShowAutocomplete(true);
    if (acDebounceRef.current) clearTimeout(acDebounceRef.current);
    acDebounceRef.current = setTimeout(() => fetchAutocomplete(val), 200);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length >= 2) {
      debounceRef.current = setTimeout(() => { performSearch(val.trim()); doAiSearch(val.trim()); }, 350);
    }
  };

  const handleFediverseFollow = async (account: any) => {
    if (!user) { navigate('/auth'); return; }
    try {
      const target = account.actor_url || `${account.username}@${account.domain}`;
      await federation.follow(target);
      toast.success(`Follow request sent to @${account.username}@${account.domain}`);
    } catch { toast.error('Follow failed'); }
  };

  const hasQuery = query.trim().length > 0;

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Search" showBack />

      <div className="sticky top-14 z-30 bg-background border-b border-border" ref={searchContainerRef}>
        <form onSubmit={handleSearch} className="p-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search posts, people, #hashtags…"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onFocus={() => setShowAutocomplete(true)}
              className="pl-12 h-11 rounded-full bg-muted border-0 focus-visible:ring-2 focus-visible:ring-primary"
            />
            {query && (
              <button type="button" onClick={() => { setQuery(''); setAcUsers([]); setAcHashtags([]); setShowAutocomplete(false); setAiSearchResult(null); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            )}

            {/* ── Autocomplete Dropdown ── */}
            {showAutocomplete && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1.5 bg-background border border-border rounded-2xl shadow-2xl overflow-hidden max-h-80 overflow-y-auto">
                {recentSearches.length > 0 && !acUsers.length && !acHashtags.length && (
                  <div>
                    <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Recent</p>
                      <button type="button" onClick={() => { setRecentSearches([]); localStorage.removeItem('tsocial_recent_searches'); }}
                        className="text-[10px] text-muted-foreground hover:text-foreground">Clear all</button>
                    </div>
                    {recentSearches.map(s => (
                      <div key={s} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors group">
                        <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                        <button type="button" className="flex-1 text-sm text-left"
                          onClick={() => { setQuery(s); setShowAutocomplete(false); navigate(`/search?q=${encodeURIComponent(s)}`); saveRecentSearch(s); }}>
                          {s}
                        </button>
                        <button type="button" onClick={() => clearRecentSearch(s)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-opacity">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {acUsers.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-4 pt-3 pb-1.5">People</p>
                    {acUsers.map(u => (
                      <button type="button" key={u.id}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors text-left"
                        onClick={() => { saveRecentSearch(`@${u.username}`); setShowAutocomplete(false); navigate(`/profile/${u.username}`); }}>
                        <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                          {u.avatar_url ? <img src={u.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center font-bold text-xs">{u.username[0]?.toUpperCase()}</div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-semibold truncate">@{u.username}</span>
                            {u.verified && <BadgeCheck className="w-3 h-3 text-primary shrink-0" fill="currentColor" />}
                          </div>
                          <p className="text-[11px] text-muted-foreground">{formatNumber(u.followers_count || 0)} followers</p>
                        </div>
                        <TrendingUp className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {acHashtags.length > 0 && (
                  <div className="pb-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-4 pt-3 pb-2">Hashtags</p>
                    <div className="flex flex-wrap gap-2 px-4">
                      {acHashtags.map(h => (
                        <button type="button" key={h.id}
                          onClick={() => { saveRecentSearch(`#${h.tag}`); setShowAutocomplete(false); navigate(`/hashtag/${h.tag}`); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/8 hover:bg-primary/15 border border-primary/15 rounded-full text-xs font-semibold text-primary transition-colors">
                          <Hash className="w-3 h-3" /><span>#{h.tag}</span>
                          <span className="text-primary/50 font-normal">{formatNumber(h.usage_count)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {query.trim().length >= 2 && !acUsers.length && !acHashtags.length && !recentSearches.length && (
                  <div className="px-4 py-5 text-center text-sm text-muted-foreground">
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    No suggestions for "{query}"
                  </div>
                )}
              </div>
            )}
          </div>
        </form>

        {/* ── Filter Bar ── */}
        {showFilters && (
          <div className="px-3 py-2 border-t border-border/50 bg-muted/20 space-y-2">
            {/* Date range */}
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <div className="flex gap-1.5 flex-wrap">
                {(['all', '24h', 'week', 'month'] as DateFilter[]).map(d => (
                  <button key={d} onClick={() => setFilterDate(d)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                      filterDate === d ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}>
                    {d === 'all' ? 'All time' : d === '24h' ? 'Past 24h' : d === 'week' ? 'This week' : 'This month'}
                  </button>
                ))}
              </div>
            </div>
            {/* Media type */}
            <div className="flex items-center gap-2">
              <Image className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <div className="flex gap-1.5">
                {(['all', 'images', 'videos'] as MediaFilter[]).map(m => (
                  <button key={m} onClick={() => setFilterMedia(m)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                      filterMedia === m ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}>
                    {m === 'videos' && <Video className="w-3 h-3" />}
                    {m === 'images' && <Image className="w-3 h-3" />}
                    {m === 'all' ? 'All media' : m === 'images' ? 'Images' : 'Videos'}
                  </button>
                ))}
              </div>
            </div>
            {/* Verified only */}
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <button onClick={() => setFilterVerified(p => !p)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                  filterVerified ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}>
                <BadgeCheck className="w-3 h-3" />
                Verified only
              </button>
              {activeFilterCount > 0 && (
                <button onClick={() => { setFilterDate('all'); setFilterMedia('all'); setFilterVerified(false); }}
                  className="text-[11px] text-destructive hover:underline ml-1">Clear all</button>
              )}
            </div>
          </div>
        )}

        {/* ── Content-Type Filter Chips + Sort ───────────────────────────────────── */}
        {hasQuery && (
          <div className="px-3 py-2 border-t border-border/50 bg-background flex items-center gap-2 overflow-x-auto scrollbar-hide">
            <div className="flex items-center gap-1.5 flex-1 overflow-x-auto scrollbar-hide">
              {CONTENT_TYPE_FILTERS.map(ct => (
                <button
                  key={ct}
                  onClick={() => setContentTypeFilter(ct)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${
                    contentTypeFilter === ct
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  }`}
                >
                  {ct === 'Videos' ? '🎥 ' : ct === 'Posts' ? '📝 ' : ct === 'Users' ? '👤 ' : ct === 'Hashtags' ? '# ' : ct === 'Threads' ? '🧵 ' : ''}{ct}
                </button>
              ))}
            </div>
            {/* Sort dropdown */}
            <div className="relative shrink-0">
              <button
                onClick={() => setShowSortDropdown(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 border-border text-xs font-bold text-muted-foreground hover:border-primary/40 transition-all whitespace-nowrap"
              >
                <TrendingUp className="w-3 h-3" />{sortOption}
              </button>
              {showSortDropdown && (
                <div className="absolute right-0 top-full mt-1 bg-background border border-border rounded-2xl shadow-xl z-50 overflow-hidden min-w-[140px]">
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      onClick={() => { setSortOption(opt); setShowSortDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-xs font-semibold transition-colors hover:bg-muted ${
                        sortOption === opt ? 'text-primary' : 'text-foreground'
                      }`}
                    >{opt}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex overflow-x-auto scrollbar-hide border-t border-border/50">
          {/* Moved the Filter button outside the tabs.map as it's not a tab itself but a toggle for filters */}
          <button onClick={() => setShowFilters(p => !p)}
            className={`shrink-0 px-3 py-3 font-semibold transition-colors border-b-2 flex items-center gap-1.5 text-sm relative ${
              showFilters ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:bg-muted/50'
            }`}>
            <Filter className="w-3.5 h-3.5" />
            {activeFilterCount > 0 && (
              <span className="absolute top-2 right-1 w-3.5 h-3.5 bg-primary text-primary-foreground text-[8px] font-black rounded-full flex items-center justify-center">{activeFilterCount}</span>
            )}
          </button>
          {tabs.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`shrink-0 px-4 py-3 font-semibold transition-colors border-b-2 flex items-center gap-1.5 text-sm ${
                activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {tab === 'For You' && <Sparkles className="w-3.5 h-3.5" />}
              {tab === 'Fediverse' && <Globe className="w-3.5 h-3.5" />}
              {tab === 'Hashtags' && <Hash className="w-3.5 h-3.5" />}
              {tab === 'Communities' && <Users className="w-3.5 h-3.5" />}
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── AI Search Insight Banner ── */}
      {hasQuery && (aiSearching || aiSearchResult) && (
        <div className="mx-4 mt-3 p-3.5 bg-gradient-to-br from-primary/8 via-purple-500/5 to-background border border-primary/20 rounded-2xl">
          <div className="flex items-center gap-2 mb-1.5">
            <Brain className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs font-bold text-primary uppercase tracking-wide">Wise Brain Insight</span>
            {aiSearching && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-auto" />}
          </div>
          {aiSearchResult ? (
            <p className="text-sm text-foreground leading-relaxed">{aiSearchResult}</p>
          ) : (
            <div className="space-y-1.5">
              <div className="h-3 bg-muted/60 rounded-full w-4/5 animate-pulse" />
              <div className="h-3 bg-muted/60 rounded-full w-3/5 animate-pulse" />
            </div>
          )}
        </div>
      )}

      {/* ── AdSense banner ── */}
      <SearchAdBanner />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* ── FOR YOU TAB (smart discovery when no query, search results when query) ── */}
          {activeTab === 'For You' && (
            !hasQuery ? (
              discoveryLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : (
                <div className="pb-4">
                  {/* Trending Hashtags */}
                  {trendingHashtags.length > 0 && (
                    <div className="px-4 pt-4 pb-2">
                      <div className="flex items-center gap-2 mb-3">
                        <Flame className="w-4 h-4 text-orange-500" />
                        <h3 className="font-bold text-sm">Trending Now</h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {trendingHashtags.map((h: any) => (
                          <button key={h.id} onClick={() => navigate(`/hashtag/${h.tag}`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-orange-500/10 to-amber-500/10 border border-orange-500/20 rounded-full text-sm font-semibold text-orange-600 dark:text-orange-400 hover:opacity-80 transition-opacity">
                            <Hash className="w-3.5 h-3.5" />#{h.tag}
                            <span className="text-orange-400/60 text-[10px] font-normal">{formatNumber(h.usage_count)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* People You May Know */}
                  {suggestedUsers.length > 0 && (
                    <div className="px-4 pt-5 pb-2">
                      <div className="flex items-center gap-2 mb-3">
                        <UserPlus className="w-4 h-4 text-primary" />
                        <h3 className="font-bold text-sm">{user ? 'Suggested for You' : 'Popular Creators'}</h3>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        {suggestedUsers.map((u: any) => {
                          const tier = u.creator_tier;
                          // esbuild guard: parallel arrays instead of Record<string,meta> in .map()
                          const tierIdx = TIER_KEYS.indexOf(tier ?? '');
                          const tierMeta = tierIdx >= 0 ? { emoji: TIER_EMOJIS[tierIdx] } : null;
                          return (
                            <div key={u.id} onClick={() => navigate(`/profile/${u.username}`)}
                              className="flex flex-col items-center gap-2 p-3 border border-border rounded-2xl bg-card hover:border-primary/30 hover:bg-muted/20 transition-all cursor-pointer">
                              <div className="relative">
                                <div className="w-12 h-12 rounded-full bg-muted overflow-hidden">
                                  {u.avatar_url ? <img src={u.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center font-bold">{u.username[0]?.toUpperCase()}</div>}
                                </div>
                                {tierMeta && <span className="absolute -bottom-0.5 -right-0.5 text-sm">{tierMeta.emoji}</span>}
                              </div>
                              <div className="text-center min-w-0">
                                <div className="flex items-center gap-1 justify-center">
                                  <span className="text-xs font-bold truncate max-w-[80px]">{u.username}</span>
                                  {u.verified && <BadgeCheck className="w-3 h-3 text-primary shrink-0" fill="currentColor" />}
                                </div>
                                <p className="text-[10px] text-muted-foreground">{formatNumber(u.followers_count || 0)} followers</p>
                                {u._reason && <p className="text-[9px] text-primary mt-0.5">{u._reason}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Wise Brain Ad */}
                  <div className="mx-4 mt-4">
                    <DynamicAd location="feed_inline" className="rounded-2xl overflow-hidden" />
                  </div>

                  {/* For You Posts */}
                  {forYouPosts.length > 0 && (
                    <div className="mt-4">
                      <div className="flex items-center gap-2 px-4 mb-2">
                        <Sparkles className="w-4 h-4 text-primary" />
                        <h3 className="font-bold text-sm">{user ? 'Recommended For You' : 'Trending Posts'}</h3>
                      </div>
                      {forYouPosts.map((post: any) => (
                        <PostCard key={post.id} post={post} onUpdate={loadDiscovery} />
                      ))}
                    </div>
                  )}

                  {/* Search Data Export + Clear */}
                  {(searchTermFrequency.length > 0 || userInterests.length > 0) && (
                    <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BarChart2 className="w-4 h-4 text-primary" />
                        <h3 className="font-bold text-sm">Your Search Data</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const exportData = {
                              exported_at: new Date().toISOString(),
                              frequent_searches: searchTermFrequency.map(([term, freq]) => ({ term, count: freq })),
                              interests: userInterests.map(({ tag, score }) => ({ hashtag: tag, interest_score: score })),
                              recent_searches: recentSearches,
                            };
                            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `testagram-search-data-${new Date().toISOString().slice(0,10)}.json`;
                            document.body.appendChild(a);
                            a.click();
                            setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 500);
                            import('sonner').then(({ toast }) => toast.success('Search data exported!'));
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary/8 hover:bg-primary/15 border border-primary/20 rounded-full text-xs font-bold text-primary transition-colors"
                        >
                          <Download className="w-3 h-3" /> Export
                        </button>
                        <button
                          onClick={() => {
                            setRecentSearches([]);
                            try {
                              localStorage.removeItem('tsocial_recent_searches');
                              localStorage.removeItem('tsocial_all_searches');
                            } catch {}
                            import('sonner').then(({ toast }) => toast.success('Search data cleared'));
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-destructive/8 hover:bg-destructive/15 border border-destructive/20 rounded-full text-xs font-bold text-destructive transition-colors"
                        >
                          <Trash2 className="w-3 h-3" /> Clear
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Search History Analytics */}
                  {(searchTermFrequency.length > 0 || userInterests.length > 0) && (
                    <div className="px-4 pt-5 pb-2">
                      <div className="flex items-center gap-2 mb-3">
                        <BarChart2 className="w-4 h-4 text-primary" />
                        <h3 className="font-bold text-sm">Your Search Trends</h3>
                        <span className="text-xs text-muted-foreground ml-auto">Based on your activity</span>
                      </div>

                      {searchTermFrequency.length > 0 && (
                        <div className="mb-4">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1"><History className="w-3 h-3" /> Frequent Searches</p>
                          <div className="flex flex-wrap gap-2">
                            {searchTermFrequency.map(([term, freq]) => {
                              const maxFreq = searchTermFrequency[0]?.[1] ?? 1;
                              const weight = freq / maxFreq;
                              const size = weight > 0.8 ? 'text-base font-black' : weight > 0.5 ? 'text-sm font-bold' : 'text-xs font-semibold';
                              const opacity = weight > 0.6 ? 'opacity-100' : weight > 0.3 ? 'opacity-75' : 'opacity-55';
                              return (
                                <button key={term}
                                  onClick={() => { setQuery(term); saveRecentSearch(term); navigate(`/search?q=${encodeURIComponent(term)}`); }}
                                  className={`${size} ${opacity} px-2.5 py-1 rounded-full bg-primary/8 hover:bg-primary/15 text-primary border border-primary/10 transition-all hover:scale-105`}
                                  title={`Searched ${freq} time${freq !== 1 ? 's' : ''}`}
                                >
                                  {term}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {userInterests.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Your Interests</p>
                          <div className="flex flex-wrap gap-2">
                            {userInterests.map(({ tag, score }) => {
                              const maxScore = userInterests[0]?.score ?? 1;
                              const weight = score / maxScore;
                              const size = weight > 0.8 ? 'text-sm font-black' : weight > 0.5 ? 'text-xs font-bold' : 'text-xs font-semibold';
                              return (
                                <button key={tag}
                                  onClick={() => navigate(`/hashtag/${tag}`)}
                                  className={`${size} flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/8 hover:bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/15 transition-all`}
                                >
                                  <span>#</span>{tag}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {forYouPosts.length === 0 && suggestedUsers.length === 0 && !discoveryLoading && searchTermFrequency.length === 0 && (
                    <div className="text-center py-16 text-muted-foreground">
                      <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="font-semibold">Search for anything</p>
                      <p className="text-sm mt-1">Posts, people, hashtags, and communities</p>
                    </div>
                  )}
                </div>
              )
            ) : (
              /* Search results for For You tab = best-scored posts */
              getFilteredPosts().length > 0 ? (
                <div>
                  {/* Threads section — shown when contentTypeFilter === 'Threads' or 'All' */}
                  {(contentTypeFilter === 'Threads' || contentTypeFilter === 'All') && threads.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/20">
                        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Threads</span>
                        <span className="text-xs text-muted-foreground">({threads.length})</span>
                      </div>
                      {threads.slice(0, 3).map((t: any) => (
                        <button key={t.id} onClick={() => navigate(`/thread/${t.id}`)}
                          className="w-full flex items-start gap-3 px-4 py-3 border-b border-border hover:bg-muted/30 transition-colors text-left">
                          {t.cover_image && (
                            <div className="w-12 h-12 rounded-xl overflow-hidden bg-muted shrink-0">
                              <img src={t.cover_image} alt="" className="w-full h-full object-cover" loading="lazy" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm line-clamp-1">{t.title}</p>
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{t.content?.slice(0, 100)}</p>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                              <span>@{t.user_profiles?.username}</span>
                              <span>{formatNumber(t.views_count ?? 0)} views</span>
                              <span>{formatNumber(t.likes_count ?? 0)} likes</span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {contentTypeFilter !== 'Threads' && getFilteredPosts().slice(0, 5).map((post: any, i: number) => (
                    <div key={post.id}>
                      <PostCard post={post} onUpdate={() => performSearch(query)} />
                      {i === 2 && (
                        <div className="px-4 py-2 bg-muted/20 border-b border-border">
                          <DynamicAd location="feed_inline" className="rounded-xl overflow-hidden" />
                        </div>
                      )}
                    </div>
                  ))}
                  {contentTypeFilter !== 'Threads' && getFilteredPosts().length > 5 && getFilteredPosts().slice(5).map((post: any) => (
                    <PostCard key={post.id} post={post} onUpdate={() => performSearch(query)} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No results found for "{query}"</p>
                </div>
              )
            )
          )}

          {activeTab === 'Posts' && (
            getFilteredPosts().length > 0 ? (
              getFilteredPosts().map((post) => (
                <PostCard key={post.id} post={post} onUpdate={() => performSearch(query)} />
              ))
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <p>No {contentTypeFilter !== 'All' ? contentTypeFilter.toLowerCase() : 'posts'} found{query ? ` for "${query}"` : ''}</p>
              </div>
            )
          )}

          {activeTab === 'Users' && (
            <div className="divide-y divide-border">
              {users.length > 0 ? (
                users.map((u) => (
                  <div key={u.id} onClick={() => navigate(`/profile/${u.username}`)}
                    className="p-4 hover:bg-muted/5 cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-muted overflow-hidden">
                        {u.avatar_url ? <img src={u.avatar_url} alt={u.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold">{u.username[0].toUpperCase()}</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold">{u.username}</p>
                          {u.verified && <BadgeCheck className="w-4 h-4 text-primary" fill="currentColor" />}
                          {u.creator_tier && u.creator_tier !== 'free' && (
                            <span className="text-xs font-bold">{u.creator_tier === 'gold' ? '🥇' : u.creator_tier === 'silver' ? '🥈' : '🥉'}</span>
                          )}
                        </div>
                        {u.bio && <p className="text-sm text-muted-foreground line-clamp-1">{u.bio}</p>}
                        <p className="text-xs text-muted-foreground">{formatNumber(u.followers_count || 0)} followers</p>
                      </div>
                      {u.verified && (
                        <div className="shrink-0 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">Verified</div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No users found{query ? ` for "${query}"` : ''}</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'Hashtags' && (
            <div className="divide-y divide-border">
              {hashtags.length > 0 ? (
                hashtags.map((h) => (
                  <button key={h.id} onClick={() => navigate(`/hashtag/${h.tag}`)}
                    className="w-full flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors text-left">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Hash className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-primary">#{h.tag}</p>
                      <p className="text-sm text-muted-foreground">{formatNumber(h.usage_count)} posts</p>
                    </div>
                    {h.usage_count > 100 && (
                      <span className="flex items-center gap-1 text-xs text-orange-500 font-semibold bg-orange-500/10 px-2 py-0.5 rounded-full shrink-0">
                        <Flame className="w-3 h-3" /> Hot
                      </span>
                    )}
                  </button>
                ))
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Hash className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No hashtags found{query ? ` for "${query}"` : ''}</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'Communities' && (
            <div className="divide-y divide-border">
              {communities.length > 0 ? (
                communities.map((c) => (
                  <button key={c.id} onClick={() => navigate(`/c/${c.name}`)}
                    className="w-full flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors text-left">
                    <div className="w-12 h-12 rounded-xl bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                      {c.icon_url ? <img src={c.icon_url} alt={c.display_name} className="w-full h-full object-cover" /> : <span className="text-lg font-bold">{c.display_name[0]}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{c.display_name}</p>
                      {c.description && <p className="text-sm text-muted-foreground line-clamp-1">{c.description}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <Users className="w-3 h-3 inline mr-1" />{formatNumber(c.member_count)} members
                      </p>
                    </div>
                    {c.member_count > 500 && (
                      <span className="text-[10px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full shrink-0">Popular</span>
                    )}
                  </button>
                ))
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No communities found{query ? ` for "${query}"` : ''}</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'Fediverse' && (
            <div className="divide-y divide-border">
              <div className="px-4 py-3 bg-purple-500/5 border-b border-purple-500/10">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-purple-500" />
                  Search across Mastodon, Misskey, Pleroma and 8000+ servers — try @user@domain
                </p>
              </div>
              {fediverseLoading && <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
              {!fediverseLoading && fediverseResults.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Globe className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Search for Fediverse users</p>
                  <p className="text-sm mt-1">Try: @alice@mastodon.social</p>
                </div>
              )}
              {fediverseResults.map((account: any) => (
                <div key={account.actor_url} className="p-4 hover:bg-muted/5">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-muted overflow-hidden shrink-0">
                      {account.avatar_url ? <img src={account.avatar_url} alt={account.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-lg">{account.username[0]?.toUpperCase()}</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold">{account.display_name || account.username}</p>
                        <span className="flex items-center gap-1 px-1.5 py-0.5 bg-purple-500/10 rounded-full">
                          <Globe className="w-3 h-3 text-purple-500" />
                          <span className="text-xs text-purple-500">{account.domain}</span>
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">@{account.username}@{account.domain}</p>
                      {account.bio && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2" dangerouslySetInnerHTML={{ __html: account.bio }} />}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <a href={account.actor_url} target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-muted rounded-full transition-colors" onClick={e => e.stopPropagation()}>
                        <ExternalLink className="w-4 h-4 text-muted-foreground" />
                      </a>
                      <button onClick={() => handleFediverseFollow(account)} className="p-2 hover:bg-primary/10 rounded-full transition-colors">
                        <UserPlus className="w-4 h-4 text-primary" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
