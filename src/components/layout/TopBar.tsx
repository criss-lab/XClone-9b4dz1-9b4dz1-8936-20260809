import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Settings } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { MobileSidebarDrawer } from './MobileSidebarDrawer';

interface TopBarProps { title?: string; showProfile?: boolean; showBack?: boolean; showSettings?: boolean; onBack?: () => void; }
export function TopBar({ title, showProfile = true, showBack = false, showSettings = false, onBack }: TopBarProps) {
  const { user } = useAuth(); const navigate = useNavigate(); const location = useLocation(); const isHome = location.pathname === '/';
  return <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border"><div className="flex items-center justify-between px-4 h-14"><div className="lg:hidden"><MobileSidebarDrawer /></div><div className="flex items-center space-x-3">{showBack && <button onClick={onBack ?? (() => navigate(-1))} className="p-2 hover:bg-muted rounded-full"><ArrowLeft className="w-5 h-5" /></button>}{isHome ? <div className="flex items-center gap-2"><img src="/tsocial-logo.png" alt="Tsocial" className="w-8 h-8 rounded-lg object-cover" /><span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Tsocial</span></div> : title ? <h1 className="text-xl font-bold">{title ?? ""}</h1> : null}</div><div className="flex items-center space-x-2">{showSettings && <button onClick={() => navigate('/settings')} className="p-2 hover:bg-muted rounded-full"><Settings className="w-5 h-5" /></button>}{showProfile && user && <button onClick={() => navigate(`/profile/${user.username}`)} className="p-1 rounded-full"><div className="w-8 h-8 rounded-full bg-muted overflow-hidden">{user.avatar ? <img src={user.avatar} alt="Profile" className="w-full h-full object-cover" /> : <span className="flex h-full items-center justify-center text-xs font-bold">{user.username?.[0]?.toUpperCase()}</span>}</div></button>}<ThemeToggle /></div></div></div>;
}
