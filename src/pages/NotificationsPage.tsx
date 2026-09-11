import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { AtSign, Bell, CheckCheck, Filter, Flame, Globe, Heart, Loader2, Mail, MessageCircle, Repeat2, Search, Settings2, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { useFediversePolling } from '@/hooks/useFediversePolling';

const PAGE_SIZE = 30;
type FilterKey = 'all' | 'unread' | 'social' | 'mentions' | 'payments' | 'creator' | 'fediverse';
type NotificationRow = any;
const SOCIAL = new Set(['like', 'repost', 'follow', 'reply', 'mention', 'quote', 'comment']);
const PAYMENTS = new Set(['payment_success', 'payment_sent', 'payment_failed', 'payout_sent', 'deposit_confirmed', 'boost_activated']);
const CREATOR = new Set(['ad_active', 'ad_rejected', 'new_ad', 'tip_received', 'streak_milestone', 'leaderboard', 'verification', 'community', 'live_event', 'live_gift', 'sponsorship']);

function iconFor(kind: string) {
  if (kind === 'like') return <Heart className="w-5 h-5 text-pink-500" fill="currentColor" />;
  if (kind === 'repost') return <Repeat2 className="w-5 h-5 text-green-500" />;
  if (kind === 'follow') return <UserPlus className="w-5 h-5 text-primary" />;
  if (kind === 'reply' || kind === 'comment' || kind === 'quote') return <MessageCircle className="w-5 h-5 text-blue-500" />;
  if (kind === 'mention') return <AtSign className="w-5 h-5 text-violet-500" />;
  if (kind.startsWith('fediverse_')) return <Globe className="w-5 h-5 text-purple-500" />;
  if (kind.includes('payment') || kind.includes('deposit') || kind.includes('payout')) return <ShieldCheck className="w-5 h-5 text-green-600" />;
  if (kind === 'streak_milestone') return <Flame className="w-5 h-5 text-orange-500" />;
  return <Bell className="w-5 h-5 text-muted-foreground" />;
}

function textFor(n: NotificationRow) {
  const actor = n.actor?.username ? `@${n.actor.username}` : 'Someone';
  const data = n.data ?? {};
  switch (n.kind) {
    case 'like': return `${actor} liked your post`;
    case 'repost': return `${actor} reposted your post`;
    case 'follow': return `${actor} followed you`;
    case 'reply': return `${actor} replied to your post`;
    case 'comment': return `${actor} commented on your post`;
    case 'mention': return `${actor} mentioned you`;
    case 'quote': return `${actor} quoted your post`;
    case 'fediverse_follow': return `${actor} followed you from the Fediverse`;
    case 'fediverse_mention': return `${actor} mentioned you from the Fediverse`;
    case 'fediverse_like': return `${actor} favourited your federated post`;
    case 'fediverse_repost': return `${actor} boosted your federated post`;
    case 'payment_success': return data.message ?? `Payment of ${data.amount ?? ''} confirmed`;
    case 'deposit_confirmed': return `Deposit confirmed${data.receipt ? ` · Receipt ${data.receipt}` : ''}`;
    case 'payment_sent': return `Payment of ${data.amount ?? ''} sent`;
    case 'payout_sent': return `Payout of ${data.amount ?? ''} sent via ${data.method ?? 'payout'}`;
    case 'payment_failed': return `Payment failed${data.reason ? ` — ${data.reason}` : ''}`;
    case 'boost_activated': return `Your boost is now active${data.estimated_reach ? ` · estimated reach ${Number(data.estimated_reach).toLocaleString()}` : ''}`;
    case 'streak_milestone': return `🔥 You reached a ${data.streak_day ?? ''}-day streak milestone`;
    case 'tip_received': return `You received a creator tip${data.amount ? ` of ${data.amount}` : ''}`;
    case 'ad_active': return 'Your ad was approved and is live';
    case 'ad_rejected': return 'Your ad was rejected — review the campaign details';
    case 'new_ad': return `${actor} submitted an ad for review`;
    case 'verification': return data.message ?? 'Your verification status was updated';
    case 'leaderboard': return data.message ?? 'Your leaderboard position changed';
    default: return data.message ?? 'You have a new notification';
  }
}

function avatarFor(n: NotificationRow) {
  if (n.actor?.avatar_url) return <img src={n.actor.avatar_url} alt={n.actor.username ?? ''} className="w-10 h-10 rounded-full object-cover" />;
  return <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">{(n.actor?.username ?? 'T').slice(0, 1).toUpperCase()}</div>;
}

export default function NotificationsPage() {
  useSEO({ noindex: true, title: 'Notifications', url: '/notifications' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const { notifs: fedNotifs, loading: fedLoading, lastPolled, refresh: refreshFed } = useFediversePolling(filter === 'fediverse' ? user?.id : null);

  const hydrate = useCallback(async (base: any[]) => {
    const actorIds = [...new Set(base.map(n => n.actor_id).filter(Boolean))];
    const postIds = [...new Set(base.map(n => n.post_id).filter(Boolean))];
    const [actorsResult, postsResult] = await Promise.all([
      actorIds.length ? supabase.from('user_profiles').select('id,username,display_name,avatar_url,verified').in('id', actorIds) : Promise.resolve({ data: [] as any[] }),
      postIds.length ? supabase.from('posts').select('id,content,body').in('id', postIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const actors = new Map((actorsResult.data ?? []).map((a: any) => [a.id, a]));
    const posts = new Map((postsResult.data ?? []).map((p: any) => [p.id, p]));
    return base.map(n => ({ ...n, actor: actors.get(n.actor_id), post: posts.get(n.post_id) }));
  }, []);

  const fetchPage = useCallback(async (pageNum: number) => {
    if (!user) return [];
    let q = supabase.from('notifications').select('id,recipient_id,actor_id,kind,post_id,read_at,created_at,data,priority,category,group_key,action_url,archived_at,expires_at').eq('recipient_id', user.id).is('archived_at', null).order('created_at', { ascending: false }).range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);
    if (filter === 'unread') q = q.is('read_at', null);
    if (filter === 'mentions') q = q.in('kind', ['mention', 'fediverse_mention']);
    if (filter === 'payments') q = q.in('kind', [...PAYMENTS]);
    if (filter === 'creator') q = q.in('kind', [...CREATOR]);
    if (filter === 'social') q = q.in('kind', [...SOCIAL]);
    const { data, error } = await q;
    if (error) throw error;
    return hydrate(data ?? []);
  }, [filter, hydrate, user]);

  const refresh = useCallback(async () => {
    if (!user || filter === 'fediverse') return;
    setLoading(true);
    try {
      const data = await fetchPage(0);
      setRows(data);
      setPage(0);
      setHasMore(data.length === PAGE_SIZE);
      setSelected([]);
    } catch (e) {
      console.error('[notifications] fetch failed', e);
      toast.error('Could not load notifications');
    } finally { setLoading(false); }
  }, [fetchPage, filter, user]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(`notifications:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` }, async payload => {
        const hydrated = await hydrate([payload.new]);
        setRows(prev => [hydrated[0], ...prev.filter(r => r.id !== payload.new.id)]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` }, payload => {
        setRows(prev => prev.map(r => r.id === payload.new.id ? { ...r, ...payload.new } : r).filter(r => !r.archived_at));
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [hydrate, user]);

  const unreadCount = rows.filter(n => !n.read_at).length;
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? rows.filter(n => `${textFor(n)} ${n.post?.content ?? ''}`.toLowerCase().includes(needle)) : rows;
  }, [query, rows]);

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    const { error } = await supabase.rpc('mark_notifications_read', { p_notification_ids: ids });
    if (error) { toast.error('Could not update notifications'); return; }
    setRows(prev => prev.map(n => ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n));
  };

  const archive = async (ids: string[]) => {
    if (!ids.length) return;
    const { error } = await supabase.rpc('archive_notifications', { p_notification_ids: ids });
    if (error) { toast.error('Could not clear notifications'); return; }
    setRows(prev => prev.filter(n => !ids.includes(n.id)));
    setSelected(prev => prev.filter(id => !ids.includes(id)));
    toast.success(ids.length === 1 ? 'Notification cleared' : `${ids.length} notifications cleared`);
  };

  const loadMore = async () => {
    if (!hasMore || loadingMore || filter === 'fediverse') return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await fetchPage(next);
      setRows(prev => [...prev, ...data]);
      setPage(next);
      setHasMore(data.length === PAGE_SIZE);
    } finally { setLoadingMore(false); }
  };

  if (!user) return null;
  const filters: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }, { key: 'social', label: 'Social' }, { key: 'mentions', label: 'Mentions' }, { key: 'payments', label: 'Payments' }, { key: 'creator', label: 'Creator' }, { key: 'fediverse', label: 'Fediverse' },
  ];

  return <div className="min-h-screen bg-background pb-16 md:pb-0">
    <TopBar />
    <PageAdBanner />
    <div className="sticky top-14 z-30 bg-background/95 backdrop-blur border-b border-border">
      <div className="max-w-3xl mx-auto px-3 py-2 flex items-center gap-2">
        <div className="flex-1"><h1 className="font-black text-lg">Notifications</h1><p className="text-[11px] text-muted-foreground">{unreadCount ? `${unreadCount} unread` : "You're all caught up"}</p></div>
        {unreadCount > 0 && <button onClick={() => markRead(rows.filter(n => !n.read_at).map(n => n.id))} className="px-3 py-2 rounded-full text-xs font-bold text-primary hover:bg-primary/10 flex items-center gap-1"><CheckCheck className="w-4 h-4" /> Read all</button>}
        <button onClick={() => setShowFilters(v => !v)} className={`p-2 rounded-full ${showFilters ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}><Filter className="w-4 h-4" /></button>
        <button onClick={() => navigate('/notification-preferences')} className="p-2 rounded-full hover:bg-muted"><Settings2 className="w-4 h-4" /></button>
      </div>
      <div className="max-w-3xl mx-auto px-3 pb-2 flex gap-2 overflow-x-auto scrollbar-hide">{filters.map(f => <button key={f.key} onClick={() => setFilter(f.key)} className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${filter === f.key ? 'bg-primary text-primary-foreground' : 'bg-muted/60 hover:bg-muted text-muted-foreground'}`}>{f.label}{f.key === 'unread' && unreadCount > 0 ? ` · ${unreadCount}` : ''}</button>)}</div>
      {showFilters && <div className="max-w-3xl mx-auto px-3 pb-3 flex gap-2"><div className="flex-1 flex items-center gap-2 border border-border rounded-xl px-3 bg-muted/30"><Search className="w-4 h-4 text-muted-foreground" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search notifications…" className="bg-transparent outline-none py-2 text-sm w-full" />{query && <button onClick={() => setQuery('')}><X className="w-4 h-4" /></button>}</div>{selected.length > 0 && <button onClick={() => archive(selected)} className="px-3 rounded-xl border border-destructive/30 text-destructive text-xs font-bold flex items-center gap-1"><Trash2 className="w-4 h-4" /> Clear</button>}</div>}
    </div>

    {filter === 'fediverse' ? <div className="max-w-3xl mx-auto"><div className="px-4 py-2 flex items-center justify-between text-xs border-b border-purple-500/10 bg-purple-500/5 text-purple-500"><span><Globe className="w-3 h-3 inline mr-1" />Live Fediverse inbox{lastPolled ? ` · ${formatDistanceToNow(lastPolled, { addSuffix: true })}` : ''}</span><button onClick={refreshFed} className="font-bold">Refresh</button></div>{fedLoading && !fedNotifs.length ? <Spinner /> : fedNotifs.length ? fedNotifs.map((n: any, i: number) => <div key={n.id ?? i} className="p-4 border-b border-border"><div className="flex gap-3"><div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">{iconFor(`fediverse_${n.activity_type ?? n.type}`)}</div><div><p className="text-sm font-semibold">{n.actor_url ?? n.account?.url ?? 'Remote user'} interacted with you</p><p className="text-xs text-muted-foreground mt-1">{n.activity_type ?? n.type} · {n.created_at ? formatDistanceToNow(new Date(n.created_at), { addSuffix: true }) : 'recently'}</p></div></div></div>) : <Empty title="No Fediverse notifications" body="Follows, mentions, favourites and boosts from federated networks will appear here." />}</div> : loading ? <Spinner /> : filteredRows.length === 0 ? <Empty title={query ? 'No matches' : filter === 'unread' ? 'Nothing unread' : 'No notifications yet'} body={query ? 'Try another search.' : 'Your social activity, creator events and account updates will appear here.'} /> : <div className="max-w-3xl mx-auto">{filteredRows.map(n => { const unread = !n.read_at; const checked = selected.includes(n.id); return <div key={n.id} className={`group p-4 border-b border-border ${unread ? 'bg-primary/[0.035]' : ''} hover:bg-muted/30`}><div className="flex gap-3 items-start"><input aria-label="Select notification" type="checkbox" checked={checked} onChange={() => setSelected(prev => checked ? prev.filter(id => id !== n.id) : [...prev, n.id])} className="mt-3 accent-primary" /><div className="relative shrink-0">{avatarFor(n)}<span className="absolute -right-1 -bottom-1 w-6 h-6 rounded-full bg-background border border-border flex items-center justify-center">{iconFor(n.kind)}</span></div><button onClick={() => { if (unread) void markRead([n.id]); if (n.action_url) navigate(n.action_url); else if (n.post_id) navigate(`/post/${n.post_id}`); else if (n.actor?.username) navigate(`/profile/${n.actor.username}`); }} className="flex-1 min-w-0 text-left"><div className="flex items-start gap-2"><p className="text-sm font-medium flex-1">{textFor(n)}</p>{unread && <span className="w-2.5 h-2.5 rounded-full bg-primary mt-1.5 shrink-0" />}</div>{n.post?.content && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.post.content}</p>}<div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground"><span className="capitalize">{n.category ?? 'social'}</span><span>·</span><span>{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>{n.priority === 'urgent' && <span className="text-destructive font-bold">Urgent</span>}</div></button><div className="opacity-0 group-hover:opacity-100 flex items-center gap-1"><button title="Mark unread" onClick={() => supabase.from('notifications').update({ read_at: null }).eq('id', n.id).eq('recipient_id', user.id).then(({ error }) => { if (!error) setRows(prev => prev.map(r => r.id === n.id ? { ...r, read_at: null } : r)); })} className="p-2 rounded-full hover:bg-muted"><Mail className="w-4 h-4" /></button><button title="Clear" onClick={() => archive([n.id])} className="p-2 rounded-full hover:bg-destructive/10 text-destructive"><Trash2 className="w-4 h-4" /></button></div></div></div>; })}{hasMore && <button onClick={loadMore} disabled={loadingMore} className="w-full py-5 text-sm font-bold text-primary">{loadingMore ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Load more'}</button>}</div>}
  </div>;
}

function Spinner() { return <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="py-20 text-center text-muted-foreground px-6"><div className="w-16 h-16 rounded-2xl bg-muted/60 mx-auto mb-4 flex items-center justify-center"><Bell className="w-9 h-9" /></div><p className="font-bold text-foreground">{title}</p><p className="text-sm mt-1 max-w-sm mx-auto">{body}</p></div>; }
