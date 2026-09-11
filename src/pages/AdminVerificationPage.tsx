import { useState, useEffect } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ShieldCheck, Clock, CheckCircle, XCircle, Loader2, BadgeCheck, Crown, Star, Zap, Users, RefreshCw, ChevronDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { formatNumber } from '@/lib/utils';
import { PageAdBanner } from '@/components/features/AdSenseAd';
function AdminVerificationAdBanner() { return <PageAdBanner />; }

interface VerificationRequest { id: string; user_id: string; tier: string; payment_status: string; payment_amount: number; status: string; admin_notes: string | null; created_at: string; processed_at: string | null; user: { username: string; email: string; avatar_url?: string; followers_count: number; bio?: string; verified: boolean }; }
type FilterStatus = 'pending' | 'approved' | 'rejected' | 'all';
const TIER_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any; price: number }> = {
  basic: { label: 'Basic', color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30', icon: BadgeCheck, price: 5 },
  blue: { label: 'Blue', color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30', icon: BadgeCheck, price: 5 },
  creator: { label: 'Creator', color: 'text-purple-600', bg: 'bg-purple-100 dark:bg-purple-900/30', icon: Star, price: 15 },
  gold: { label: 'Gold', color: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/30', icon: Star, price: 15 },
  business: { label: 'Business', color: 'text-amber-600', bg: 'bg-amber-100 dark:bg-amber-900/30', icon: Crown, price: 25 },
  celebrity: { label: 'Celebrity', color: 'text-rose-600', bg: 'bg-rose-100 dark:bg-rose-900/30', icon: Zap, price: 50 },
};

export default function AdminVerificationPage() {
  const { user } = useAuth();
  useSEO({ noindex: true, title: 'Admin — Verifications', url: '/admin/verify' });
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [filter, setFilter] = useState<FilterStatus>('pending');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, total: 0 });

  const fetchRequests = async () => {
    const { data, error } = await supabase.from('verification_requests').select('*, user:user_profiles(username,email,avatar_url,followers_count,bio,verified)').order('created_at', { ascending: false });
    if (error) { toast.error(error.message); return; }
    const rows = (data as any[]) || [];
    setRequests(rows);
    setStats({ pending: rows.filter(r => r.status === 'pending').length, approved: rows.filter(r => r.status === 'approved').length, rejected: rows.filter(r => r.status === 'rejected').length, total: rows.length });
  };
  const checkAdmin = async () => {
    if (!user) return;
    const { data, error } = await supabase.from('platform_admins').select('user_id,role').eq('user_id', user.id).maybeSingle();
    if (error || !data) { toast.error('Admin access required'); navigate('/'); return; }
    setIsAdmin(true); await fetchRequests(); setLoading(false);
  };
  useEffect(() => { if (!user) { navigate('/auth'); return; } void checkAdmin(); }, [user?.id]);

  const handleDecision = async (req: VerificationRequest, approve: boolean) => {
    setActionLoading(req.id);
    try {
      const { error } = await supabase.rpc('process_verification_request', { p_request_id: req.id, p_approve: approve, p_admin_notes: adminNotes[req.id] || null });
      if (error) throw error;
      toast.success(approve ? `@${req.user.username} is now verified ✓` : 'Verification rejected');
      setExpandedId(null); await fetchRequests();
    } catch (e: any) { toast.error(e.message || 'Could not process verification'); }
    finally { setActionLoading(null); }
  };

  if (!user || loading) return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!isAdmin) return null;
  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);

  return <div className="min-h-screen bg-background pb-20 md:pb-4"><TopBar title="Verification Dashboard" showBack /><AdminVerificationAdBanner /><div className="max-w-2xl mx-auto p-4 space-y-5">
    <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-2xl p-5"><div className="flex items-center gap-4"><div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center"><ShieldCheck className="w-6 h-6 text-primary" /></div><div className="flex-1"><h1 className="text-xl font-bold">Verification Queue</h1><p className="text-sm text-muted-foreground">Review and approve user badge requests</p></div><button onClick={() => void fetchRequests()} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><RefreshCw className="w-4 h-4" /></button></div></div>
    <div className="grid grid-cols-4 gap-2">{[{ label: 'Pending', value: stats.pending }, { label: 'Approved', value: stats.approved }, { label: 'Rejected', value: stats.rejected }, { label: 'Total', value: stats.total }].map(s => <div key={s.label} className="bg-card border border-border rounded-xl p-3 text-center"><p className="text-2xl font-bold">{s.value}</p><p className="text-xs text-muted-foreground mt-0.5">{s.label}</p></div>)}</div>
    <div className="flex gap-2 overflow-x-auto pb-1">{(['pending','approved','rejected','all'] as FilterStatus[]).map(f => <button key={f} onClick={() => setFilter(f)} className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold capitalize ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{f === 'pending' && stats.pending > 0 ? `Pending (${stats.pending})` : f}</button>)}</div>
    <div className="space-y-3">{filtered.length === 0 && <div className="text-center py-16 text-muted-foreground"><ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-30" /><p className="font-medium">No {filter === 'all' ? '' : filter} requests</p></div>}
      {filtered.map(req => { const tierCfg = TIER_CONFIG[req.tier] || TIER_CONFIG.basic; const TierIcon = tierCfg.icon; const isExpanded = expandedId === req.id; const isPending = req.status === 'pending'; const isBusy = actionLoading === req.id; return <div key={req.id} className={`bg-card border rounded-2xl overflow-hidden ${isPending ? 'border-amber-500/30' : 'border-border'}`}>
        <div className="p-4"><div className="flex items-start gap-3"><div className="w-12 h-12 rounded-full bg-muted overflow-hidden flex-shrink-0">{req.user?.avatar_url ? <img src={req.user.avatar_url} alt={req.user.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-lg font-bold">{req.user?.username?.[0]?.toUpperCase()}</div>}</div><div className="flex-1 min-w-0"><div className="flex items-center gap-1.5 flex-wrap"><span className="font-bold truncate">@{req.user?.username}</span>{req.user?.verified && <BadgeCheck className="w-4 h-4 text-primary flex-shrink-0" /> }<span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold ${tierCfg.bg} ${tierCfg.color}`}><TierIcon className="w-3 h-3" />{tierCfg.label}</span></div><p className="text-sm text-muted-foreground truncate">{req.user?.email}</p><div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Users className="w-3 h-3" />{formatNumber(req.user?.followers_count || 0)} followers</span><span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}</span></div></div><div className="flex flex-col items-end gap-1.5"><span className="text-xs font-semibold uppercase">{req.status}</span><span className="text-sm font-bold text-green-600 dark:text-green-400">${req.payment_amount}</span><span className="text-xs text-muted-foreground">Payment: {req.payment_status}</span></div></div>{req.user?.bio && <p className="text-xs text-muted-foreground mt-2">{req.user.bio}</p>}{isPending && <button onClick={() => setExpandedId(isExpanded ? null : req.id)} className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-muted-foreground"><span>{isExpanded ? 'Collapse' : 'Review & Decide'}</span><ChevronDown className={`w-3 h-3 ${isExpanded ? 'rotate-180' : ''}`} /></button>}</div>
        {isExpanded && isPending && <div className="border-t border-border bg-muted/30 p-4 space-y-3"><textarea value={adminNotes[req.id] || ''} onChange={e => setAdminNotes(prev => ({ ...prev, [req.id]: e.target.value }))} placeholder="Add a note for the applicant…" rows={2} className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 resize-none" /><div className="flex gap-2"><Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" disabled={isBusy} onClick={() => void handleDecision(req, true)}>{isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle className="w-4 h-4 mr-1.5" />Approve</>}</Button><Button variant="destructive" className="flex-1" disabled={isBusy} onClick={() => void handleDecision(req, false)}>{isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><XCircle className="w-4 h-4 mr-1.5" />Reject</>}</Button></div></div>}
      </div>; })}
    </div>
  </div></div>;
}
