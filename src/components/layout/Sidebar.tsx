import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { authService } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { formatNumber } from '@/lib/utils';
import { useFediversePolling } from '@/hooks/useFediversePolling';
import { useIsRegulator } from '@/hooks/useFeatureUnlock';
import { Home, Hash, Bell, Mail, Radio, Sparkles, Globe, Trophy, Bookmark, List, History, Flame, UserSearch, Gift, Wallet, Settings, LogOut, Plus, Users, Briefcase, BarChart3, DollarSign, ShoppingBag, Calendar, Crown, Shield, Megaphone, Inbox, BookOpen, ShoppingCart, FileText } from 'lucide-react';

interface Community { id: string; name: string; display_name: string; icon_url?: string | null; member_count?: number | null; }

const primaryItems = [
  { icon: Home, label: 'Home', path: '/', requireAuth: false },
  { icon: Hash, label: 'Explore', path: '/explore', requireAuth: false },
  { icon: FileText, label: 'Threads', path: '/threads', requireAuth: false },
  { icon: Bell, label: 'Notifications', path: '/notifications', requireAuth: true },
  { icon: Mail, label: 'Messages', path: '/messages', requireAuth: true },
  { icon: Radio, label: 'Spaces', path: '/spaces', requireAuth: false },
  { icon: Sparkles, label: 'AI', path: '/ai', requireAuth: false },
  { icon: Globe, label: 'Fediverse', path: '/fediverse', requireAuth: false },
  { icon: Trophy, label: 'Leaderboard', path: '/leaderboard', requireAuth: false },
];

const userItems = [
  { icon: Bookmark, label: 'Bookmarks', path: '/bookmarks' }, { icon: List, label: 'Lists', path: '/lists' },
  { icon: History, label: 'History', path: '/history' }, { icon: Flame, label: 'Daily Rewards', path: '/daily-rewards' },
  { icon: UserSearch, label: 'Discover', path: '/discover' }, { icon: Gift, label: 'Refer & Earn', path: '/referral' },
  { icon: Wallet, label: 'Wallet', path: '/wallet' }, { icon: DollarSign, label: 'Payouts', path: '/payouts' },
  { icon: Megaphone, label: 'My Ads', path: '/my-ads' }, { icon: BookOpen, label: 'Series', path: '/series' },
  { icon: ShoppingCart, label: 'Orders', path: '/orders' }, { icon: Inbox, label: 'Wise Brain', path: '/platform-inbox' },
];

const creatorItems = [
  { icon: Briefcase, label: 'Creator Studio', path: '/creator-studio' }, { icon: BarChart3, label: 'Analytics', path: '/analytics' },
  { icon: DollarSign, label: 'Monetization', path: '/monetization' }, { icon: ShoppingBag, label: 'Products', path: '/products' },
  { icon: Calendar, label: 'Scheduled', path: '/scheduled' },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const isReg = useIsRegulator();
  const { unreadCount: unreadFed } = useFediversePolling(user?.id);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [trendingCommunities, setTrendingCommunities] = useState<Community[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase.from('communities').select('id,name,display_name,icon_url,member_count').order('member_count', { ascending: false }).limit(5);
      if (active) setTrendingCommunities((data ?? []).filter((c: any): c is Community => Boolean(c?.id && c?.name)));
      if (!user) { if (active) setCommunities([]); return; }
      const { data: memberships } = await supabase.from('community_members').select('communities(id,name,display_name,icon_url,member_count)').eq('user_id', user.id).limit(5);
      const safe = (memberships ?? []).map((row: any) => row?.communities).filter((c: any): c is Community => Boolean(c?.id && c?.name && c?.display_name));
      if (active) setCommunities(safe);
    };
    void load();
    return () => { active = false; };
  }, [user?.id]);

  const go = (path: string, requireAuth = false) => navigate(requireAuth && !user ? '/auth' : path);
  const active = (path: string) => location.pathname === path || (path !== '/' && location.pathname.startsWith(path));
  const renderItems = (items: typeof primaryItems) => items.map(({ icon: Icon, label, path, requireAuth }) => (
    <button key={path} onClick={() => go(path, requireAuth)} className={`flex items-center gap-3 px-4 py-3 rounded-lg w-full text-left transition-colors ${active(path) ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-muted text-foreground'}`}>
      <Icon className="w-5 h-5 shrink-0" /><span>{label}</span>{path === '/fediverse' && unreadFed > 0 && <span className="ml-auto text-xs rounded-full bg-red-500 text-white px-1.5">{unreadFed > 99 ? '99+' : unreadFed}</span>}
    </button>
  ));

  return <aside className="hidden lg:flex lg:flex-col w-72 h-screen sticky top-0 border-r border-border overflow-y-auto">
    <div className="flex items-center gap-2 p-4 border-b border-border"><img src="/tsocial-logo.png" alt="Testagram" className="w-10 h-10 rounded-xl object-cover" /><span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Tsocial</span></div>
    <nav className="flex-1 p-2 space-y-1">{renderItems(primaryItems)}
      {user && <><div className="mt-5 mb-2 px-4 text-xs font-semibold text-muted-foreground uppercase">Library</div>{userItems.map(({ icon: Icon, label, path }) => <button key={path} onClick={() => go(path, true)} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg w-full text-left text-sm transition-colors ${active(path) ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'}`}><Icon className="w-4 h-4" /><span>{label}</span></button>)}<div className="mt-5 mb-2 px-4 text-xs font-semibold text-muted-foreground uppercase">Creator Tools</div>{creatorItems.map(({ icon: Icon, label, path }) => <button key={path} onClick={() => go(path, true)} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg w-full text-left text-sm transition-colors ${active(path) ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'}`}><Icon className="w-4 h-4" /><span>{label}</span></button>)}{isReg && <><div className="mt-5 mb-2 px-4 text-xs font-semibold text-muted-foreground uppercase">Regulator</div><button onClick={() => go('/regulator', true)} className="flex items-center gap-3 px-4 py-2.5 rounded-lg w-full text-left text-sm hover:bg-muted"><Crown className="w-4 h-4" /><span>Regulator Panel</span></button><button onClick={() => go('/appeals', true)} className="flex items-center gap-3 px-4 py-2.5 rounded-lg w-full text-left text-sm hover:bg-muted"><Shield className="w-4 h-4" /><span>Appeals</span></button></>}</>}
      <div className="mt-5 mb-2 px-4 text-xs font-semibold text-muted-foreground uppercase">Communities</div><button onClick={() => go('/communities')} className="flex items-center gap-3 px-4 py-2.5 rounded-lg w-full text-left text-sm hover:bg-muted"><Plus className="w-4 h-4" /><span>Discover Communities</span></button>{communities.map(c => <button key={c.id} onClick={() => go(`/c/${c.name}`)} className="flex items-center gap-3 px-4 py-2 rounded-lg w-full text-left text-sm hover:bg-muted"><div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">{c.icon_url ? <img src={c.icon_url} alt={c.display_name} className="w-full h-full object-cover" /> : <span>{c.display_name?.[0] ?? '?'}</span>}</div><span className="truncate">{c.display_name}</span></button>)}{trendingCommunities.length > 0 && <><div className="mt-4 mb-2 px-4 text-xs font-semibold text-muted-foreground uppercase">Trending Communities</div>{trendingCommunities.map(c => <button key={`trend-${c.id}`} onClick={() => go(`/c/${c.name}`)} className="flex items-center gap-3 px-4 py-2 rounded-lg w-full text-left text-sm hover:bg-muted"><Users className="w-4 h-4" /><span className="truncate">{c.display_name}</span><span className="ml-auto text-xs text-muted-foreground">{formatNumber(c.member_count ?? 0)}</span></button>)}</>}
    </nav>
    {user && <div className="p-3 border-t border-border"><button onClick={async () => { await authService.signOut(); logout(); go('/'); }} className="flex items-center gap-3 px-4 py-3 rounded-lg w-full text-left text-sm text-destructive hover:bg-destructive/10"><LogOut className="w-4 h-4" /><span>Log out</span></button></div>}
  </aside>;
}
