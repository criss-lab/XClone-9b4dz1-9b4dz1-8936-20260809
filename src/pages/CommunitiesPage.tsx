import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PageAdBanner } from '@/components/features/AdSenseAd';
function CommunitiesAdBanner() { return <PageAdBanner />; }
import { TopBar } from '@/components/layout/TopBar';
import { CommunitySpacesHubNav } from '@/components/features/CommunitySpacesHubNav';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import {
  Users, Plus, TrendingUp, Loader2, Search, Lock, Globe, Shield,
  Image as ImageIcon, X, Camera, Sparkles, Flame, Star, Hash,
  Crown, ChevronRight, BarChart3, Clock, MessageCircle,
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { useSEO } from '@/hooks/useSEO';
import { toast as sonnerToast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

// Module-level category constants — esbuild-safe
const COMMUNITY_CATEGORIES = [
  { id: 'all',           label: 'All',           emoji: '🌐' },
  { id: 'technology',    label: 'Technology',    emoji: '💻' },
  { id: 'gaming',        label: 'Gaming',        emoji: '🎮' },
  { id: 'art',           label: 'Art & Design',  emoji: '🎨' },
  { id: 'music',         label: 'Music',         emoji: '🎵' },
  { id: 'sports',        label: 'Sports',        emoji: '⚽' },
  { id: 'finance',       label: 'Finance',       emoji: '💰' },
  { id: 'health',        label: 'Health',        emoji: '🏃' },
  { id: 'education',     label: 'Education',     emoji: '📚' },
  { id: 'entertainment', label: 'Entertainment', emoji: '🎭' },
] as const;

const SORT_OPTIONS = ['Popular', 'Newest', 'Active'] as const;
const COMM_TABS = ['all', 'joined', 'discover'] as const;
type CommTab = typeof COMM_TABS[number];
type SortOption = typeof SORT_OPTIONS[number];

interface Community {
  id: string;
  name: string;
  display_name: string;
  description?: string;
  icon_url?: string;
  banner_url?: string;
  member_count: number;
  post_count: number;
  created_by: string;
  is_private: boolean;
  is_member?: boolean;
  rules?: any[];
  created_at?: string;
}

export default function CommunitiesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [suggestedCommunities, setSuggestedCommunities] = useState<any[]>([]);
  const [trendingCommunities, setTrendingCommunities] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<CommTab>('all');
  const [activeCategory, setActiveCategory] = useState('all');
  const [sortBy, setSortBy] = useState<SortOption>('Popular');
  const [recentPosts, setRecentPosts] = useState<{ [cId: string]: number }>({});
  const [formData, setFormData] = useState({
    name: '',
    display_name: '',
    description: '',
    is_private: false,
    rules: ['Be respectful', 'No spam', 'Stay on topic'],
  });
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [newRule, setNewRule] = useState('');

  // ── Community spotlight rotation ──────────────────────────────────────────
  const [spotlightIdx, setSpotlightIdx] = useState(0);
  useEffect(() => {
    if (trendingCommunities.length < 2) return;
    const iv = setInterval(() => setSpotlightIdx(i => (i + 1) % trendingCommunities.length), 8000);
    return () => clearInterval(iv);
  }, [trendingCommunities.length]);

  // ── Keyboard shortcut: / → focus search ───────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const communitiesJsonLd = useMemo(() => {
    const top = communities.slice(0, 10);
    if (top.length === 0) return undefined;
    return {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Top Communities on Testagram',
      description: 'Browse the most popular communities on Testagram',
      url: 'https://testagram.site/communities',
      numberOfItems: top.length,
      itemListElement: top.map((c: any, i: number) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.display_name,
        url: `https://testagram.site/c/${c.name}`,
        description: c.description || `${c.display_name} community on Testagram — ${c.member_count?.toLocaleString() ?? 0} members`,
      })),
    };
  }, [communities]);

  useSEO({
    title: 'Discover Communities',
    description: 'Join communities on Testagram — connect with people who share your passions. Browse public communities on technology, sports, entertainment, lifestyle and more.',
    url: '/communities',
    type: 'website',
    keywords: 'communities, groups, testagram, join, forums, social groups, technology, sports, entertainment',
    structuredData: communitiesJsonLd,
  });

  useEffect(() => {
    fetchCommunities();
    fetchTrendingCommunities();
    if (user) fetchSuggestions();
  }, [user, activeTab]);

  const fetchTrendingCommunities = async () => {
    const since48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from('posts')
      .select('community_id')
      .not('community_id', 'is', null)
      .gte('created_at', since48h);
    if (!data) return;
    // Count posts per community
    const counts: { [id: string]: number } = {};
    data.forEach((r: any) => { if (r.community_id) counts[r.community_id] = (counts[r.community_id] ?? 0) + 1; });
    setRecentPosts(counts);
    const topIds = Object.keys(counts).sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0)).slice(0, 5);
    if (topIds.length === 0) return;
    const { data: comms } = await supabase
      .from('communities')
      .select('*')
      .in('id', topIds);
    if (comms) setTrendingCommunities(comms.sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0)));
  };

  const fetchSuggestions = async () => {
    if (!user) return;
    await supabase.rpc('generate_community_suggestions', { p_user_id: user.id }).then(() => {}, () => {});
    const { data } = await supabase
      .from('community_suggestions')
      .select('community_id, reason, communities(*)')
      .eq('user_id', user.id)
      .order('score', { ascending: false })
      .limit(5);
    if (data) {
      setSuggestedCommunities(data.map((d: any) => ({ ...d.communities, _reason: d.reason })).filter(Boolean));
    }
  };

  const fetchCommunities = async () => {
    try {
      let query = supabase.from('communities').select('*');
      if (sortBy === 'Newest') query = query.order('created_at', { ascending: false });
      else if (sortBy === 'Active') query = query.order('post_count', { ascending: false });
      else query = query.order('member_count', { ascending: false });

      const { data } = await query;
      if (!data) return;

      if (user) {
        const { data: memberships } = await supabase
          .from('community_members')
          .select('community_id')
          .eq('user_id', user.id);

        const memberIds = new Set(memberships?.map((m) => m.community_id));
        let enriched = data.map((c) => ({ ...c, is_member: memberIds.has(c.id) }));

        if (activeTab === 'joined') enriched = enriched.filter(c => c.is_member);
        else if (activeTab === 'discover') enriched = enriched.filter(c => !c.is_member);

        setCommunities(enriched);
      } else {
        setCommunities(data.map(c => ({ ...c, is_member: false })));
      }
    } catch (error) {
      console.error('fetchCommunities error:', error);
    } finally {
      setLoading(false);
    }
  };

  const uploadImage = async (file: File, path: string): Promise<string | null> => {
    const ext = file.name.split('.').pop();
    const fileName = `${path}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('posts').upload(fileName, file, { upsert: true });
    if (error) { console.error('Upload error:', error); return null; }
    const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(fileName);
    return publicUrl;
  };

  const handleCreateCommunity = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!formData.name.trim() || !formData.display_name.trim()) {
      toast({ title: 'Error', description: 'Name and display name are required', variant: 'destructive' });
      return;
    }

    setCreating(true);
    try {
      const communityName = formData.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!communityName) {
        toast({ title: 'Error', description: 'Community name must contain letters or numbers', variant: 'destructive' });
        return;
      }

      sonnerToast.loading('Creating community...');

      let iconUrl: string | null = null;
      let bannerUrl: string | null = null;

      if (iconFile) iconUrl = await uploadImage(iconFile, `communities/icons/${user.id}`);
      if (bannerFile) bannerUrl = await uploadImage(bannerFile, `communities/banners/${user.id}`);

      const { data, error } = await supabase
        .from('communities')
        .insert({
          name: communityName,
          display_name: formData.display_name,
          description: formData.description,
          is_private: formData.is_private,
          created_by: user.id,
          icon_url: iconUrl,
          banner_url: bannerUrl,
          rules: formData.rules.filter(r => r.trim()).map((r, i) => ({ id: i + 1, rule: r })),
        })
        .select()
        .single();

      if (error) throw error;

      await supabase.from('community_members').insert({
        community_id: data.id,
        user_id: user.id,
        role: 'owner',
      });

      sonnerToast.dismiss();
      toast({ title: '🎉 Community created!' });
      setCreateOpen(false);
      setFormData({ name: '', display_name: '', description: '', is_private: false, rules: ['Be respectful', 'No spam', 'Stay on topic'] });
      setIconFile(null); setIconPreview(null);
      setBannerFile(null); setBannerPreview(null);
      fetchCommunities();
      navigate(`/c/${communityName}`);
    } catch (error: any) {
      sonnerToast.dismiss();
      toast({ title: 'Error', description: error.message || 'Failed to create community', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = useCallback(async (communityId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!user) { navigate('/auth'); return; }
    try {
      await supabase.from('community_members').insert({ community_id: communityId, user_id: user.id });
      sonnerToast.success('Joined community!');
      fetchCommunities();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  }, [user]);

  const handleLeave = useCallback(async (communityId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!user) return;
    try {
      await supabase.from('community_members').delete().match({ community_id: communityId, user_id: user.id });
      sonnerToast.success('Left community');
      fetchCommunities();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  }, [user]);

  // Apply sort when sortBy changes
  useEffect(() => {
    if (communities.length > 0) fetchCommunities();
  }, [sortBy]);

  const filtered = useMemo(() => {
    return communities.filter(c => {
      const matchQ = !searchQuery ||
        c.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.description?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchQ;
    });
  }, [communities, searchQuery]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Spotlight community
  const spotlight = trendingCommunities[spotlightIdx];

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar />
      <CommunitySpacesHubNav />

      {/* Hero */}
      <div className="bg-gradient-to-br from-primary/12 via-background to-purple-500/8 p-5 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-2xl font-black">Communities</h2>
            <p className="text-sm text-muted-foreground">Join conversations that matter to you</p>
          </div>
          {user && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-full shadow-md shadow-primary/20">
                  <Plus className="w-4 h-4 mr-1.5" />
                  Create
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create a Community</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  {/* Banner image upload */}
                  <div>
                    <label className="text-sm font-medium block mb-1">Banner Image (optional)</label>
                    <div className="relative h-28 bg-gradient-to-r from-primary/20 to-purple-500/20 rounded-xl overflow-hidden border-2 border-dashed border-border cursor-pointer hover:border-primary/50 transition-colors">
                      {bannerPreview && (
                        <img src={bannerPreview} className="w-full h-full object-cover" alt="Banner preview" />
                      )}
                      <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer">
                        <Camera className="w-6 h-6 text-muted-foreground mb-1" />
                        <span className="text-xs text-muted-foreground">Click to upload banner</span>
                        <input type="file" accept="image/*" className="hidden"
                          onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) { setBannerFile(f); setBannerPreview(URL.createObjectURL(f)); }
                          }}
                        />
                      </label>
                      {bannerPreview && (
                        <button onClick={e => { e.preventDefault(); setBannerFile(null); setBannerPreview(null); }}
                          className="absolute top-2 right-2 w-7 h-7 bg-black/70 rounded-full flex items-center justify-center text-white">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Icon upload */}
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-2xl bg-primary/10 border-2 border-dashed border-border overflow-hidden flex items-center justify-center">
                        {iconPreview
                          ? <img src={iconPreview} className="w-full h-full object-cover" alt="Icon" />
                          : <ImageIcon className="w-6 h-6 text-muted-foreground" />}
                      </div>
                      <label className="absolute inset-0 cursor-pointer rounded-2xl">
                        <input type="file" accept="image/*" className="hidden"
                          onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) { setIconFile(f); setIconPreview(URL.createObjectURL(f)); }
                          }}
                        />
                      </label>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">Community Icon</p>
                      <p className="text-xs text-muted-foreground">Square image recommended</p>
                      {iconPreview && (
                        <button onClick={() => { setIconFile(null); setIconPreview(null); }} className="text-xs text-destructive mt-1">Remove icon</button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium block mb-1">Community Name (URL) *</label>
                    <Input placeholder="technology" value={formData.name}
                      onChange={e => setFormData(p => ({ ...p, name: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '') }))} />
                    {formData.name && <p className="text-xs text-muted-foreground mt-1">URL: /c/{formData.name}</p>}
                  </div>

                  <div>
                    <label className="text-sm font-medium block mb-1">Display Name *</label>
                    <Input placeholder="Technology Enthusiasts" value={formData.display_name}
                      onChange={e => setFormData(p => ({ ...p, display_name: e.target.value }))} />
                  </div>

                  <div>
                    <label className="text-sm font-medium block mb-1">Description</label>
                    <Textarea placeholder="What is this community about?" value={formData.description}
                      onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} rows={3} />
                  </div>

                  {/* Community Rules editor */}
                  <div>
                    <label className="text-sm font-medium block mb-2">Community Rules</label>
                    <div className="space-y-2 mb-2">
                      {formData.rules.map((rule, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs font-bold text-muted-foreground w-5 text-center">{i + 1}</span>
                          <input value={rule} onChange={e => setFormData(p => ({ ...p, rules: p.rules.map((r, j) => j === i ? e.target.value : r) }))}
                            className="flex-1 text-sm bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/40" />
                          <button onClick={() => setFormData(p => ({ ...p, rules: p.rules.filter((_, j) => j !== i) }))}
                            className="p-1 text-muted-foreground hover:text-destructive rounded"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input value={newRule} onChange={e => setNewRule(e.target.value)} placeholder="Add a rule…"
                        onKeyDown={e => { if (e.key === 'Enter' && newRule.trim()) { setFormData(p => ({ ...p, rules: [...p.rules, newRule.trim()] })); setNewRule(''); } }}
                        className="flex-1 text-xs bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 focus:outline-none" />
                      <button onClick={() => { if (newRule.trim()) { setFormData(p => ({ ...p, rules: [...p.rules, newRule.trim()] })); setNewRule(''); } }}
                        className="px-3 py-1.5 bg-muted border border-border rounded-lg text-xs font-semibold hover:bg-muted/80">Add</button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 border border-border rounded-xl cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setFormData(p => ({ ...p, is_private: !p.is_private }))}>
                    {formData.is_private
                      ? <Lock className="w-5 h-5 text-orange-500" />
                      : <Globe className="w-5 h-5 text-primary" />}
                    <div>
                      <p className="font-medium text-sm">{formData.is_private ? 'Private Community' : 'Public Community'}</p>
                      <p className="text-xs text-muted-foreground">
                        {formData.is_private ? 'Only members can see content and posts' : 'Anyone can join and see posts'}
                      </p>
                    </div>
                    <div className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${formData.is_private ? 'border-orange-500 bg-orange-500' : 'border-border'}`}>
                      {formData.is_private && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                  </div>

                  <Button onClick={handleCreateCommunity} disabled={creating || !formData.name || !formData.display_name} className="w-full rounded-full">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                    Create Community
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input ref={searchInputRef} className="pl-9 pr-10 bg-background" placeholder="Search communities… (press / to focus)"
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Category pills */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide border-b border-border">
        {COMMUNITY_CATEGORIES.map(cat => (
          <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
              activeCategory === cat.id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted/60 text-muted-foreground hover:text-foreground'
            }`}>
            <span>{cat.emoji}</span>{cat.label}
          </button>
        ))}
      </div>

      {/* Tabs + Sort */}
      {user && (
        <div className="sticky top-14 z-20 bg-background border-b border-border">
          <div className="flex items-center">
            {COMM_TABS.map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex-1 py-3 text-sm font-semibold transition-colors border-b-2 capitalize ${
                  activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/50'
                }`}>
                {tab}
              </button>
            ))}
            {/* Sort dropdown */}
            <div className="px-3">
              <select value={sortBy} onChange={e => setSortBy(e.target.value as SortOption)}
                className="text-xs bg-muted border border-border rounded-lg px-2 py-1.5 focus:outline-none font-semibold cursor-pointer">
                {SORT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      <CommunitiesAdBanner />

      <div className="p-4 space-y-4">

        {/* ── Trending Spotlight Card ── */}
        {spotlight && !searchQuery && (
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/8 to-purple-500/5 cursor-pointer hover:border-primary/30 transition-all"
            onClick={() => navigate(`/c/${spotlight.name}`)}>
            {spotlight.banner_url && (
              <div className="h-24 overflow-hidden">
                <img src={spotlight.banner_url} alt="" className="w-full h-full object-cover opacity-60" />
              </div>
            )}
            <div className="p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Flame className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-[10px] font-black text-orange-500 uppercase tracking-wide">Trending Now</span>
                {trendingCommunities.length > 1 && (
                  <div className="ml-auto flex gap-1">
                    {trendingCommunities.slice(0, 5).map((_, i) => (
                      <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === spotlightIdx ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center overflow-hidden shrink-0 shadow-md">
                  {spotlight.icon_url
                    ? <img src={spotlight.icon_url} alt="" className="w-full h-full object-cover" />
                    : <span className="text-xl font-black text-primary">{spotlight.display_name[0]}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-base truncate">{spotlight.display_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{spotlight.description ?? `c/${spotlight.name}`}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Users className="w-3 h-3" />{formatNumber(spotlight.member_count)} members
                    </span>
                    {recentPosts[spotlight.id] > 0 && (
                      <span className="flex items-center gap-1 text-orange-500 font-semibold">
                        <BarChart3 className="w-3 h-3" />{recentPosts[spotlight.id]} posts (48h)
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); navigate(`/c/${spotlight.name}`); }}
                  className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:opacity-90 shrink-0">
                  Explore <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Suggested for You ── */}
        {user && suggestedCommunities.length > 0 && activeTab !== 'joined' && !searchQuery && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-sm">Suggested for You</h3>
            </div>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
              {suggestedCommunities.map((sc: any) => (
                <div key={sc.id} className="flex-shrink-0 w-44 border border-border rounded-2xl overflow-hidden hover:border-primary/30 transition-colors cursor-pointer bg-card"
                  onClick={() => navigate(`/c/${sc.name}`)}>
                  <div className="h-14 bg-gradient-to-br from-primary/20 to-purple-500/20 overflow-hidden">
                    {sc.banner_url ? <img src={sc.banner_url} className="w-full h-full object-cover" alt="" /> : null}
                  </div>
                  <div className="p-2.5">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <div className="w-7 h-7 rounded-lg bg-muted overflow-hidden shrink-0">
                        {sc.icon_url
                          ? <img src={sc.icon_url} className="w-full h-full object-cover" alt="" />
                          : <span className="w-full h-full flex items-center justify-center font-bold text-xs text-primary">{sc.display_name?.[0]}</span>}
                      </div>
                      <p className="font-bold text-xs truncate">{sc.display_name}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{formatNumber(sc.member_count)} members</p>
                    {sc._reason && <p className="text-[10px] text-primary mt-0.5 line-clamp-1">{sc._reason}</p>}
                    <button onClick={e => { e.stopPropagation(); handleJoin(sc.id, e); }}
                      className="mt-2 w-full py-1.5 text-[10px] font-bold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity">
                      Join
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Community List ── */}
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="font-semibold">No communities found</p>
            <p className="text-sm mt-1">
              {activeTab === 'joined' ? "You haven't joined any communities yet" : 'Try a different search or category'}
            </p>
            {activeTab === 'joined' && (
              <Button onClick={() => setActiveTab('discover')} variant="outline" className="mt-4 rounded-full">Discover communities</Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(community => {
              const recent48h = recentPosts[community.id] ?? 0;
              const isHot = recent48h >= 5;
              return (
                <div key={community.id}
                  className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/30 transition-all cursor-pointer group"
                  onClick={() => navigate(`/c/${community.name}`)}>
                  {/* Banner */}
                  {community.banner_url && (
                    <div className="h-20 overflow-hidden">
                      <img src={community.banner_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    </div>
                  )}

                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden shadow-sm ${
                          community.banner_url ? '-mt-8 ring-2 ring-background' : 'bg-primary/10'
                        }`}>
                          {community.icon_url
                            ? <img src={community.icon_url} alt={community.display_name} className="w-full h-full object-cover" />
                            : <span className="text-xl font-bold text-primary">{community.display_name[0]}</span>}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-foreground truncate">{community.display_name}</h3>
                            {isHot && (
                              <span className="flex items-center gap-0.5 text-[10px] font-black text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded-full border border-orange-500/20">
                                <Flame className="w-2.5 h-2.5" />Hot
                              </span>
                            )}
                            {community.is_private ? (
                              <span className="flex items-center gap-1 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-2 py-0.5 rounded-full">
                                <Lock className="w-3 h-3" /> Private
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                <Globe className="w-3 h-3" /> Public
                              </span>
                            )}
                            {community.is_member && (
                              <span className="flex items-center gap-1 text-xs bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full border border-green-500/20">
                                <Shield className="w-3 h-3" /> Member
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">c/{community.name}</p>
                          {community.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{community.description}</p>
                          )}

                          {/* Stats row */}
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />{formatNumber(community.member_count)} members
                            </span>
                            <span className="flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" />{formatNumber(community.post_count)} posts
                            </span>
                            {recent48h > 0 && (
                              <span className="flex items-center gap-1 text-orange-500 font-semibold">
                                <BarChart3 className="w-3 h-3" />{recent48h} in 48h
                              </span>
                            )}
                            {community.created_at && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />{formatDistanceToNow(new Date(community.created_at), { addSuffix: true })}
                              </span>
                            )}
                          </div>

                          {/* Community rules preview */}
                          {Array.isArray(community.rules) && community.rules.length > 0 && (
                            <div className="mt-2.5 flex gap-1.5 flex-wrap">
                              {(community.rules as any[]).slice(0, 2).map((r: any, i: number) => (
                                <span key={i} className="flex items-center gap-1 text-[10px] bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full border border-border">
                                  <Hash className="w-2.5 h-2.5" />{typeof r === 'string' ? r : r.rule}
                                </span>
                              ))}
                              {community.rules.length > 2 && (
                                <span className="text-[10px] text-muted-foreground px-1">+{community.rules.length - 2} more rules</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {user && (
                        <Button size="sm"
                          variant={community.is_member ? 'outline' : 'default'}
                          className="rounded-full flex-shrink-0"
                          onClick={e => {
                            e.stopPropagation();
                            community.is_member ? handleLeave(community.id, e) : handleJoin(community.id, e);
                          }}>
                          {community.is_member ? 'Joined' : 'Join'}
                        </Button>
                      )}
                    </div>

                    {/* Weekly activity heatmap strip */}
                    {community.post_count > 0 && (() => {
                      // Approximate relative activity level from post_count — normalised 0-7 bars
                      const barCount = Math.min(7, Math.max(1, Math.round((community.post_count / 100) * 7)));
                      return (
                        <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-semibold">Activity</span>
                          <div className="flex gap-0.5 flex-1">
                            {Array.from({ length: 7 }, (_, i) => (
                              <div key={i} className={`flex-1 rounded-sm h-2 transition-all ${
                                i < barCount ? 'bg-primary/60' : 'bg-muted'
                              }`} />
                            ))}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {community.post_count.toLocaleString()} total
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Create Community CTA ── */}
        {!user && (
          <div className="mt-6 p-5 border border-dashed border-border rounded-2xl text-center bg-muted/20">
            <Crown className="w-10 h-10 text-primary/40 mx-auto mb-2" />
            <p className="font-semibold mb-1">Create your own community</p>
            <p className="text-sm text-muted-foreground mb-4">Sign in to create and manage your own community</p>
            <Button onClick={() => navigate('/auth')} className="rounded-full">Sign In to Create</Button>
          </div>
        )}

        {/* ── Stats summary ── */}
        {communities.length > 0 && !searchQuery && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              { label: 'Communities', value: formatNumber(communities.length), icon: Users },
              { label: 'Total Members', value: formatNumber(communities.reduce((s, c) => s + (c.member_count ?? 0), 0)), icon: Star },
              { label: 'Total Posts', value: formatNumber(communities.reduce((s, c) => s + (c.post_count ?? 0), 0)), icon: MessageCircle },
            ].map(stat => (
              <div key={stat.label} className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                <stat.icon className="w-4 h-4 text-primary mx-auto mb-1" />
                <p className="font-black text-sm">{stat.value}</p>
                <p className="text-[10px] text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
